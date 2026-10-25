import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  createPost,
  createSession,
  dbStats,
  getPostById,
  getPostBySlug,
  getIdempotent,
  listCategories,
  listCategoriesFast,
  listLatest,
  listRelated,
  publishDue,
  readSession,
  saveIdempotent,
  searchPosts,
  searchPostsFast,
  searchPostsCapped,
  sha256Hex,
  updatePost,
  verifyApiKey,
} from "./db.js";
import { renderArticlePage } from "./render.js";
import { timingSafeEqual } from "./token.js";
import { registerPublicRoutes, errorResponse } from "./public-routes.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerApiV1Routes } from "./api-v1.js";
import { cleanupOperationalData, retentionPreview } from "./admin-data.js";
import { setSiteUrl } from "./config.js";
import { getMediaProvider, mediaEnabled, mediaObjectKey, mediaRefererAllowed } from "./media.js";
import { uploadMedia } from "./media-service.js";

export { SecureOps } from "./do.js";

const app = new Hono();

app.use("*", async (c, next) => {
  setSiteUrl(c.env.SITE_URL);
  await next();
});

app.use("*", async (c, next) => {
  await next();
  c.header("X-M0-Worker", "1");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

const timing = (started) => performance.now() - started;
const jsonError = (c, status, code, message, details) =>
  c.json({ error: { code, message, ...(details ? { details } : {}) } }, status);
const doStub = (c, name) => c.env.SECURE_OPS.get(c.env.SECURE_OPS.idFromName(name));

async function resolveCategory(db, value) {
  if (!value) return null;
  const id = await db.prepare("SELECT id FROM categories WHERE id=? OR slug=? LIMIT 1").bind(value, value).first();
  return id?.id || null;
}

async function requireApi(c, next) {
  const header = c.req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return jsonError(c, 401, "unauthorized", "Missing bearer key.");
  const client = await verifyApiKey(c.env.DB, match[1]);
  if (!client) return jsonError(c, 401, "unauthorized", "Invalid or revoked API key.");
  const limit = await doStub(c, "rate").rateLimit(
    `api:${client.id}`,
    Math.max(10, client.rate_limit_per_min || 60),
    60_000,
  );
  c.header("X-RateLimit-Limit", String(Math.max(10, client.rate_limit_per_min || 60)));
  c.header("X-RateLimit-Remaining", String(limit.remaining));
  if (!limit.allowed) {
    c.header("Retry-After", String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))));
    return jsonError(c, 429, "rate_limited", "API key rate limit exceeded.");
  }
  c.set("client", client);
  await next();
}

function hasScope(client, scope) {
  return client.scopes.includes(scope) || client.scopes.includes("*");
}

function decideStatus(client, requested, scheduledAt) {
  if (!requested) return { status: "draft", demoted: false };
  if (["published", "scheduled"].includes(requested)) {
    if (client.publish_mode === "review") return { status: "review", demoted: true };
    if (!hasScope(client, "posts:publish")) {
      const error = new Error("publish_forbidden");
      error.status = 403;
      throw error;
    }
    if (requested === "scheduled" && !scheduledAt) {
      const error = new Error("schedule_required");
      error.status = 400;
      throw error;
    }
  }
  return { status: requested, demoted: false };
}

app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

// Protected staging surface: benchmark, DB probes, auth and API routes.
app.use("/api/m0/*", async (c, next) => {
  if (c.env.ENVIRONMENT === "production") return jsonError(c, 404, "not_found", "Not found");
  if (c.req.path === "/api/m0/health") return next();
  const required = c.env.REQUIRE_STAGING_TOKEN === "1";
  const configured = c.env.STAGING_TOKEN || "";
  if (required && !configured) {
    return jsonError(c, 503, "staging_not_configured", "STAGING_TOKEN is not configured.");
  }
  if (configured) {
    const provided = c.req.header("x-staging-token") || "";
    if (!provided || !timingSafeEqual(provided, configured)) {
      return jsonError(c, 401, "staging_unauthorized", "Missing or invalid staging token.");
    }
  }
  await next();
});

app.get("/api/m0/health", async (c) => {
  const started = performance.now();
  const stats = await dbStats(c.env.DB);
  return c.json({
    ok: true,
    env: c.env.ENVIRONMENT || "local-workerd",
    stats,
    ms: timing(started),
    time: new Date().toISOString(),
  });
});

app.get("/api/m0/bench/render/:slug", async (c) => {
  const slug = c.req.param("slug");
  const iterations = Math.min(200, Math.max(1, Number(c.req.query("iterations")) || 1));
  const dbStarted = performance.now();
  const post = await getPostBySlug(c.env.DB, slug);
  if (!post) return jsonError(c, 404, "not_found", "Post not found");
  const related = await listRelated(c.env.DB, post, 4);
  const dbMs = timing(dbStarted);
  const rendered = renderArticlePage(post, { siteUrl: c.env.SITE_URL, related });
  const loopStarted = performance.now();
  for (let i = 1; i < iterations; i += 1) {
    renderArticlePage(post, { siteUrl: c.env.SITE_URL, related });
  }
  const renderMs = timing(loopStarted) + 0;
  return c.json({
    slug,
    iterations,
    db_ms: Number(dbMs.toFixed(3)),
    render_total_ms: Number(renderMs.toFixed(3)),
    render_avg_ms: Number((renderMs / iterations).toFixed(3)),
    html_bytes: new TextEncoder().encode(rendered).length,
    note: "Local workerd wall-clock measurement; not Cloudflare billed CPU.",
  });
});

app.get("/api/m0/bench/d1-meta/:slug", async (c) => {
  const slug = c.req.param("slug");
  const started = performance.now();
  const result = await c.env.DB.prepare(
    `SELECT id, slug, title, excerpt, content_html, published_at FROM posts WHERE slug=? AND status='published' LIMIT 1`,
  ).bind(slug).all();
  const tags = await c.env.DB.prepare(
    `SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=? LIMIT 8`,
  ).bind(result.results?.[0]?.id || "").all();
  return c.json({
    slug,
    rows: result.results?.length || 0,
    tags: tags.results?.length || 0,
    d1_meta: result.meta || null,
    tags_meta: tags.meta || null,
    wall_ms: Number(timing(started).toFixed(3)),
    note: "Remote D1 meta may include rows_read/rows_written; local Miniflare often only reports duration.",
  });
});

app.post("/api/m0/bench/d1-write", async (c) => {
  const id = `probe-${crypto.randomUUID()}`;
  const slug = `probe-${Date.now().toString(36)}`;
  const insert = await c.env.DB.prepare(
    "INSERT INTO tags (id,name,slug) VALUES (?,?,?)",
  ).bind(id, slug, slug).run();
  const remove = await c.env.DB.prepare("DELETE FROM tags WHERE id=?").bind(id).run();
  return c.json({
    insert_meta: insert.meta || null,
    delete_meta: remove.meta || null,
    note: "Use remote D1 metrics for quota accounting.",
  });
});

app.get("/api/m0/bench/d1/:slug", async (c) => {
  const slug = c.req.param("slug");
  const runs = Math.min(100, Math.max(1, Number(c.req.query("runs")) || 1));
  const samples = [];
  let post;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    post = await getPostBySlug(c.env.DB, slug);
    samples.push(timing(started));
  }
  if (!post) return jsonError(c, 404, "not_found", "Post not found");
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (n) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * n))];
  return c.json({
    slug,
    runs,
    db_p50_ms: Number(p(0.5).toFixed(3)),
    db_p95_ms: Number(p(0.95).toFixed(3)),
    tags: post.tags.length,
    content_bytes: post.content_html.length,
    samples: samples.slice(0, 10).map((value) => Number(value.toFixed(3))),
    note: "Local D1 (Miniflare) wall-clock; production D1 latency differs.",
  });
});

app.get("/api/m0/bench/category/:slug", async (c) => {
  const slug = c.req.param("slug");
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const started = performance.now();
  const cached = await c.env.DB.prepare(
    "SELECT cached_post_count AS n FROM categories WHERE slug=? LIMIT 1",
  ).bind(slug).first();
  const rows = await c.env.DB.prepare(
    `SELECT p.id,p.slug,p.title,p.published_at,c.name AS category_name
     FROM posts p JOIN categories c ON c.id=p.category_id
     WHERE c.slug=? AND p.status='published' AND p.deleted_at IS NULL
     ORDER BY p.published_at DESC LIMIT 8 OFFSET ?`,
  ).bind(slug, (page - 1) * 8).all();
  return c.json({
    slug,
    page,
    total: cached?.n || 0,
    returned: (rows.results || []).length,
    ms: Number(timing(started).toFixed(3)),
    note: "Local D1 category count + page query.",
  });
});

app.get("/api/m0/bench/home-uncached", async (c) => {
  const started = performance.now();
  const posts = await listLatest(c.env.DB, 16);
  const categories = await listCategories(c.env.DB);
  return c.json({
    posts: posts.length,
    categories: categories.length,
    counts: categories.map((category) => category.post_count),
    ms: Number(timing(started).toFixed(3)),
    note: "Local D1 home queries with correlated category COUNT subqueries.",
  });
});

app.get("/api/m0/bench/home-fast", async (c) => {
  const started = performance.now();
  const posts = await listLatest(c.env.DB, 16);
  const categories = await listCategoriesFast(c.env.DB);
  return c.json({
    posts: posts.length,
    categories: categories.length,
    counts: categories.map((category) => category.post_count),
    ms: Number(timing(started).toFixed(3)),
    note: "Local D1 home queries using cached category counts.",
  });
});

app.get("/api/m0/bench/home", async (c) => {
  const started = performance.now();
  const posts = await listLatest(c.env.DB, 16);
  const categories = await listCategoriesFast(c.env.DB);
  return c.json({
    posts: posts.length,
    categories: categories.length,
    first_slug: posts[0]?.slug || null,
    ms: Number(timing(started).toFixed(3)),
    note: "Local D1 home data queries.",
  });
});

app.get("/api/m0/bench/search-capped", async (c) => {
  const q = String(c.req.query("q") || "wifi");
  const candidates = Math.min(1000, Math.max(20, Number(c.req.query("candidates")) || 200));
  const started = performance.now();
  const rows = await searchPostsCapped(c.env.DB, q, 8, candidates);
  return c.json({ q, candidates, rows: rows.length, ms: Number(timing(started).toFixed(3)), first: rows[0] || null, mode: "D1 FTS5 candidate cap + bm25" });
});

app.get("/api/m0/bench/search-fast", async (c) => {
  const q = String(c.req.query("q") || "wifi");
  const started = performance.now();
  const rows = await searchPostsFast(c.env.DB, q, 8);
  return c.json({ q, rows: rows.length, ms: Number(timing(started).toFixed(3)), first: rows[0] || null, mode: "D1 FTS5 LIMIT without rank" });
});

app.get("/api/m0/bench/search", async (c) => {
  const q = String(c.req.query("q") || "wifi");
  const started = performance.now();
  const rows = await searchPosts(c.env.DB, q, 8);
  return c.json({
    q,
    rows: rows.length,
    ms: Number(timing(started).toFixed(3)),
    first: rows[0] || null,
    mode: "D1 FTS5 local",
  });
});

app.get("/api/m0/bench/categories", async (c) => {
  const started = performance.now();
  const categories = await listCategories(c.env.DB);
  return c.json({
    categories: categories.length,
    ms: Number(timing(started).toFixed(3)),
    rows: categories.map((category) => ({ slug: category.slug, count: category.post_count })),
  });
});

app.post("/api/m0/bench/sanitize", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const html = String(body.html || "");
  const format = body.format === "markdown" ? "markdown" : "html";
  const mode = body.mode === "do" ? "do" : "worker";
  if (mode === "do") {
    const result = await doStub(c, "sanitize").sanitize(html, format);
    return c.json({ mode, ...result, note: "Local DO wall-clock." });
  }
  const started = performance.now();
  const { toHtml } = await import("./sanitize.js");
  const output = toHtml(html, format);
  return c.json({
    mode,
    html: output,
    ms: Number(timing(started).toFixed(3)),
    bytes: new TextEncoder().encode(output).length,
    note: "Local Worker wall-clock.",
  });
});

app.post("/api/m0/bench/hash", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = String(body.password || "M0-Test-Password-123");
  const mode = body.mode === "do" ? "do" : "worker";
  const algorithm = body.algorithm === "pbkdf2" ? "pbkdf2" : "scrypt";
  if (mode === "do") {
    const stub = doStub(c, "auth");
    if (algorithm === "pbkdf2") {
      const result = await stub.pbkdf2(password, 600000);
      return c.json({ mode, algorithm, ...result, note: "Local DO wall-clock." });
    }
    const generated = await stub.hashScrypt(password, { N: 16384, r: 8, p: 1 });
    const verified = await stub.verifyScrypt(password, generated.hash);
    return c.json({
      mode,
      algorithm,
      hash_ms: Number(generated.ms.toFixed(3)),
      verify_ok: verified.ok,
      verify_ms: Number(verified.ms.toFixed(3)),
      note: "Local DO wall-clock.",
    });
  }
  const { hashScrypt, verifyScrypt, pbkdf2 } = await import("./auth.js");
  if (algorithm === "pbkdf2") {
    const started = performance.now();
    await pbkdf2(password, new Uint8Array(16), 600000);
    return c.json({
      mode,
      algorithm,
      ms: Number(timing(started).toFixed(3)),
      note: "Local Worker wall-clock.",
    });
  }
  const hashStarted = performance.now();
  const hash = await hashScrypt(password, { N: 16384, r: 8, p: 1 });
  const hashMs = timing(hashStarted);
  const verifyStarted = performance.now();
  const ok = await verifyScrypt(password, hash);
  return c.json({
    mode,
    algorithm,
    hash_ms: Number(hashMs.toFixed(3)),
    verify_ok: ok,
    verify_ms: Number(timing(verifyStarted).toFixed(3)),
    note: "Local Worker wall-clock; exceeds Workers Free 10ms CPU budget in all runs so far.",
  });
});

app.get("/api/m0/bench/webcrypto-scrypt", async (c) => {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("x"),
      { name: "scrypt" },
      false,
      ["deriveBits"],
    );
    await crypto.subtle.deriveBits(
      { name: "scrypt", salt: new Uint8Array(16), N: 16384, r: 8, p: 1 },
      key,
      256,
    );
    return c.json({ supported: true });
  } catch (error) {
    return c.json({ supported: false, error: String(error.message || error) });
  }
});

app.post("/api/m0/bench/cleanup", async (c) => {
  const result = await cleanupOperationalData(c.env.DB, { limit: 50 });
  return c.json({ ok: true, ...result });
});

app.get("/api/m0/bench/retention-preview", async (c) => {
  return c.json({ ok: true, ...(await retentionPreview(c.env.DB)) });
});

app.post("/api/m0/bench/reset-rate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = String(body.key || `login:${c.req.header("cf-connecting-ip") || "unknown"}`);
  await doStub(c, "rate").resetRate(key);
  return c.json({ ok: true, key });
});

app.post("/api/m0/bench/rate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = String(body.key || "rate-test");
  const max = Number(body.max) || 10;
  const windowMs = Number(body.windowMs) || 60_000;
  const result = await doStub(c, "rate").rateLimit(key, max, windowMs);
  return c.json({ key, max, windowMs, ...result, note: "Local DO SQLite-backed counter." });
});

app.post("/api/m0/db/batch-atomicity", async (c) => {
  const id = crypto.randomUUID();
  const slug = `atomic-${Date.now()}`;
  let error = null;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO tags (id,name,slug) VALUES (?,?,?)").bind(id, slug, slug),
      c.env.DB.prepare("INSERT INTO tags (id,name,slug) VALUES (?,?,?)").bind(crypto.randomUUID(), slug, slug),
    ]);
  } catch (caught) {
    error = String(caught.message || caught);
  }
  const found = await c.env.DB.prepare("SELECT id FROM tags WHERE id=?").bind(id).first();
  return c.json({
    batch_threw: Boolean(error),
    error,
    first_row_exists_after_failure: Boolean(found),
    atomic: !found,
    note: "D1 batch atomicity test; local Miniflare.",
  });
});

app.get("/api/m0/bench/concurrent", async (c) => {
  const n = Math.min(100, Math.max(1, Number(c.req.query("n")) || 20));
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: n }, () => getPostBySlug(c.env.DB, "wifi-nha-cham-7-cach-khac-phuc")),
  );
  return c.json({
    n,
    ok: results.filter(Boolean).length,
    ms: Number(timing(started).toFixed(3)),
    note: "Local D1 concurrent read test; not a production load test.",
  });
});

app.post("/api/m0/auth/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "local";
  const loginLimit = await doStub(c, "rate").rateLimit(`login:${ip}`, 15, 15 * 60_000);
  if (!loginLimit.allowed) {
    c.header("Retry-After", String(Math.max(1, Math.ceil((loginLimit.reset - Date.now()) / 1000))));
    return jsonError(c, 429, "rate_limited", "Too many login attempts.");
  }
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = await c.env.DB.prepare(
    "SELECT id,email,password_hash,name,role,is_active FROM users WHERE email=? LIMIT 1",
  )
    .bind(email)
    .first();
  if (!user || !user.is_active) return jsonError(c, 401, "invalid_credentials", "Email hoặc mật khẩu không đúng.");
  const started = performance.now();
  const verified = await doStub(c, "auth").verifyScrypt(password, user.password_hash);
  const verifyMs = timing(started);
  if (!verified.ok) return jsonError(c, 401, "invalid_credentials", "Email hoặc mật khẩu không đúng.");
  const session = await createSession(c.env.DB, user.id);
  setCookie(c, "m0_session", session.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    path: "/",
    maxAge: 8 * 3600,
  });
  return c.json({
    data: { id: user.id, email: user.email, name: user.name, role: user.role },
    csrf: session.csrf,
    verify_ms: Number(verifyMs.toFixed(3)),
    note: "Scrypt verification ran in Durable Object (local).",
  });
});

app.get("/api/m0/auth/me", async (c) => {
  const session = await readSession(c.env.DB, getCookie(c, "m0_session"));
  if (!session) return jsonError(c, 401, "unauthorized", "No session.");
  return c.json({ data: { id: session.user_id, email: session.email, name: session.name, role: session.role } });
});

app.post("/api/m0/auth/logout", async (c) => {
  const token = getCookie(c, "m0_session");
  if (token) {
    const hash = await sha256Hex(token);
    await c.env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(hash).run();
  }
  deleteCookie(c, "m0_session", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/m0/auth/protected", async (c) => {
  const session = await readSession(c.env.DB, getCookie(c, "m0_session"));
  if (!session) return jsonError(c, 401, "unauthorized", "No session.");
  const csrf = c.req.header("x-csrf-token") || "";
  if (!csrf || csrf !== session.csrf_token) return jsonError(c, 403, "csrf_invalid", "CSRF token không hợp lệ.");
  return c.json({ ok: true, user: session.user_id, role: session.role });
});

app.get("/api/m0/rbac/:role", async (c) => {
  const session = await readSession(c.env.DB, getCookie(c, "m0_session"));
  if (!session) return jsonError(c, 401, "unauthorized", "No session.");
  const required = c.req.param("role");
  const allowed = session.role === "admin" || (required === "editor" && session.role === "editor") || session.role === required;
  return allowed ? c.json({ ok: true, role: session.role }) : jsonError(c, 403, "forbidden", "Role not allowed.");
});

app.post("/api/m0/posts", requireApi, async (c) => {
  const client = c.get("client");
  if (!hasScope(client, "posts:write")) return jsonError(c, 403, "forbidden", "Missing posts:write.");
  const totalStarted = performance.now();
  const body = await c.req.json().catch(() => null);
  const { stagingPostSchema } = await import("./staging-schemas.js");
  const parsed = stagingPostSchema.safeParse(body || {});
  if (!parsed.success) {
    return jsonError(c, 400, "validation_error", "Dữ liệu không hợp lệ.", parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })));
  }
  const input = parsed.data;
  const idemKey = c.req.header("idempotency-key");
  const requestHash = await sha256Hex(JSON.stringify(body));
  if (idemKey) {
    const existing = await getIdempotent(c.env.DB, client.id, idemKey, "POST", "/api/m0/posts");
    if (existing) {
      if (existing.request_hash !== requestHash) return jsonError(c, 409, "idempotency_conflict", "Idempotency key payload mismatch.");
      c.header("Idempotent-Replayed", "true");
      return c.body(existing.response_body, existing.status_code, { "content-type": "application/json" });
    }
  }
  if (input.external_id) {
    const existing = await c.env.DB.prepare("SELECT id,slug,status FROM posts WHERE api_client_id=? AND external_id=? LIMIT 1")
      .bind(client.id, input.external_id)
      .first();
    if (existing) return c.json({ data: existing, meta: { external_id_replayed: true } }, 200);
  }
  const requested = input.status || "draft";
  const scheduledAt = input.scheduled_at || null;
  let decision;
  try {
    decision = decideStatus(client, requested, scheduledAt);
  } catch (error) {
    return jsonError(c, error.status || 400, error.message, error.message);
  }
  const content = input.content || "";
  if (["review", "published", "scheduled"].includes(decision.status) && content.trim().length < 20) {
    return jsonError(c, 400, "validation_error", "Content too short.");
  }
  if (decision.status === "scheduled" && (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now())) {
    return jsonError(c, 400, "validation_error", "scheduled_at must be in the future.");
  }
  const categoryId = await resolveCategory(c.env.DB, input.category);
  const sanitizerMode = c.req.query("sanitizer") === "do" ? "do" : "worker";
  let html;
  let sanitizeMs;
  if (sanitizerMode === "do") {
    const result = await doStub(c, "sanitize").sanitize(content, input.content_format || "html");
    html = result.html;
    sanitizeMs = result.ms;
  } else {
    const started = performance.now();
    const { toHtml } = await import("./sanitize.js");
    html = toHtml(content, input.content_format || "html");
    sanitizeMs = timing(started);
  }
  const post = await createPost(c.env.DB, {
    title: input.title,
    slug: input.slug,
    excerpt: input.excerpt,
    lede: input.lede,
    content_html: html,
    content_source: content,
    content_format: input.content_format || "html",
    status: decision.status,
    categoryId,
    authorId: "user-m0-admin",
    coverImage: input.cover_image,
    coverAlt: input.cover_alt,
    seoTitle: "",
    seoDescription: input.excerpt || "",
    publishedAt: decision.status === "published" ? new Date().toISOString() : null,
    scheduledAt: decision.status === "scheduled" ? scheduledAt : null,
    apiClientId: client.id,
    externalId: input.external_id || null,
    tags: input.tags || [],
  });
  const payload = {
    data: {
      id: post.id,
      slug: post.slug,
      status: post.status,
      content_html: post.content_html,
      content_bytes: post.content_html.length,
    },
    meta: {
      publish_mode: client.publish_mode,
      publish_demoted: decision.demoted,
      sanitizer: sanitizerMode,
      sanitize_ms: Number(sanitizeMs.toFixed(3)),
      total_ms: Number(timing(totalStarted).toFixed(3)),
    },
  };
  const serialized = JSON.stringify(payload);
  if (idemKey) {
    await saveIdempotent(c.env.DB, client.id, idemKey, "POST", "/api/m0/posts", requestHash, 201, serialized);
  }
  return c.body(serialized, 201, { "content-type": "application/json" });
});

app.get("/api/m0/posts/:id", requireApi, async (c) => {
  if (!hasScope(c.get("client"), "posts:read")) return jsonError(c, 403, "forbidden", "Missing posts:read.");
  const post = await getPostById(c.env.DB, c.req.param("id"));
  if (!post) return jsonError(c, 404, "not_found", "Post not found.");
  return c.json({ data: { id: post.id, slug: post.slug, title: post.title, status: post.status, content_html: post.content_html } });
});

app.patch("/api/m0/posts/:id", requireApi, async (c) => {
  const client = c.get("client");
  if (!hasScope(client, "posts:write")) return jsonError(c, 403, "forbidden", "Missing posts:write.");
  const body = await c.req.json().catch(() => ({}));
  const existing = await getPostById(c.env.DB, c.req.param("id"));
  if (!existing) return jsonError(c, 404, "not_found", "Post not found.");
  const patch = {};
  if (body.title !== undefined) patch.title = String(body.title).slice(0, 200);
  if (body.excerpt !== undefined) patch.excerpt = String(body.excerpt).slice(0, 500);
  if (body.content !== undefined) {
    const { toHtml } = await import("./sanitize.js");
    const html = toHtml(body.content, body.content_format || existing.content_format);
    patch.content_html = html;
    patch.content_source = body.content;
    patch.content_format = body.content_format || existing.content_format;
  }
  if (body.status !== undefined) {
    try {
      const decision = decideStatus(client, body.status, body.scheduled_at);
      patch.status = decision.status;
    } catch (error) {
      return jsonError(c, error.status || 400, error.message, error.message);
    }
  }
  const updated = await updatePost(c.env.DB, existing.id, patch);
  return c.json({ data: { id: updated.id, status: updated.status, title: updated.title } });
});

app.post("/api/m0/posts/:id/publish", requireApi, async (c) => {
  const client = c.get("client");
  if (client.publish_mode !== "auto") return jsonError(c, 403, "publish_mode_review", "Review mode cannot publish directly.");
  if (!hasScope(client, "posts:publish")) return jsonError(c, 403, "forbidden", "Missing posts:publish.");
  const post = await getPostById(c.env.DB, c.req.param("id"));
  if (!post) return jsonError(c, 404, "not_found", "Post not found.");
  const updated = await updatePost(c.env.DB, post.id, {
    status: "published",
    published_at: new Date().toISOString(),
  });
  return c.json({ data: { id: updated.id, status: updated.status } });
});

app.post("/api/m0/cron/run", async (c) => {
  const started = performance.now();
  const result = await publishDue(c.env.DB);
  return c.json({ ...result, ms: Number(timing(started).toFixed(3)) });
});

app.post("/api/m0/media", requireApi, async (c) => {
  if (!hasScope(c.get("client"), "media:write")) return jsonError(c, 403, "forbidden", "Missing media:write.");
  if (!mediaEnabled(c.env)) {
    return jsonError(c, 501, "media_not_configured", "Media storage is not configured in this staging run.");
  }
  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return jsonError(c, 400, "validation_error", "Missing file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadMedia(c.env, {
    bytes,
    originalName: file.name,
    declaredMime: file.type,
    alt: form.get("alt"),
  });
  if (result.error) return jsonError(c, result.error.status, result.error.code, result.error.message);
  return c.json({ data: result.data }, 201);
});

app.get("/media/:filename", async (c) => {
  const provider = getMediaProvider(c.env);
  if (!provider.enabled) return c.text("Not found", 404);
  if (!mediaRefererAllowed(c.env, c.req.header("referer"))) return c.text("Hotlink not allowed", 403);
  const object = await provider.get(mediaObjectKey(c.req.param("filename")));
  if (!object) return c.text("Not found", 404);
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "public, max-age=2592000, immutable",
      "content-length": String(object.size ?? ""),
      "x-content-type-options": "nosniff",
      "x-m0-worker": "1",
    },
  });
});

registerApiV1Routes(app);
registerAdminRoutes(app);
registerPublicRoutes(app);

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/media/")) {
    return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
  }
  return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
});

app.onError((error, c) => {
  console.error("worker.error", error);
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { code: "internal_error", message: "Máy chủ gặp sự cố khi xử lý yêu cầu." } }, 500);
  }
  return c.text("Máy chủ gặp sự cố khi xử lý yêu cầu.", 500);
});

async function runScheduled(env) {
  const started = performance.now();
  try {
    const result = await publishDue(env.DB);
    const cleanup = await cleanupOperationalData(env.DB, { limit: 50 });
    const heartbeat = { at: new Date().toISOString(), ok: true, ...result, cleanup, ms: timing(started) };
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('cron_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).bind(JSON.stringify(heartbeat)).run();
    console.log(JSON.stringify({ event: "cron.publish_due", ...heartbeat }));
    return { ...result, cleanup };
  } catch (error) {
    const heartbeat = { at: new Date().toISOString(), ok: false, error: String(error?.message || error).slice(0, 300) };
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('cron_last_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).bind(JSON.stringify(heartbeat)).run().catch(() => {});
    console.error(JSON.stringify({ event: "cron.failed", ...heartbeat }));
    throw error;
  }
}

export default {
  fetch: app.fetch,
  async scheduled(event, env) {
    await runScheduled(env);
  },
};
