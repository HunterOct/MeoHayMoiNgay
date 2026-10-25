import { Hono } from "hono";
import * as data from "./admin-data.js";
import { verifyApiKey, getIdempotent, saveIdempotent, sha256Hex } from "./db.js";
import { serializePost } from "./api-serialize.js";
import { plainText } from "./text.js";
import { resolveCoverMedia } from "./media-service.js";
import { config } from "./config.js";

const MAX_CONTENT_CHARS = 200_000;
const STATUSES = ["draft", "review", "scheduled", "published", "archived"];

class ApiError extends Error {
  constructor(status, code, message, details = null, extra = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.extra = extra;
  }
}

function jsonError(c, status, code, message, details = null, extra = null) {
  const body = { error: { code, message, ...(extra || {}), ...(details ? { details } : {}), request_id: crypto.randomUUID() } };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...(extra?.current_version ? { ETag: `"v${extra.current_version}"` } : {}),
    },
  });
}

function hasScope(client, scope) {
  return Boolean(client?.scopes?.includes(scope) || client?.scopes?.includes("*"));
}

function requireScope(c, scope) {
  if (!hasScope(c.get("client"), scope)) {
    throw new ApiError(403, "forbidden", `API key thiếu quyền ${scope}.`);
  }
}

function doStub(c, name) {
  return c.env.SECURE_OPS.get(c.env.SECURE_OPS.idFromName(name));
}

function requestIp(c) {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
}

function parseBody(c, schema) {
  const body = c.get("jsonBody") || {};
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "validation_error",
      "Dữ liệu không hợp lệ.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join(".") || "(body)", message: issue.message })),
    );
  }
  return parsed.data;
}

function parseDate(value, { future = false, field = "scheduled_at" } = {}) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "validation_error", `${field} không phải thời gian hợp lệ (ISO 8601).`, [
      { path: field, message: "Định dạng thời gian không hợp lệ." },
    ]);
  }
  if (future && date.getTime() <= Date.now() + 30_000) {
    throw new ApiError(400, "validation_error", `${field} phải ở tương lai.`, [
      { path: field, message: "Thời điểm phải trong tương lai." },
    ]);
  }
  return date.toISOString();
}

function resolveStatus(client, requested, { scheduledAt = null } = {}) {
  if (!requested) return { status: null, demoted: false, scheduledAt };
  if (["published", "scheduled"].includes(requested)) {
    if (client.publish_mode === "review") return { status: "review", demoted: true, scheduledAt: null };
    if (!hasScope(client, "posts:publish")) {
      throw new ApiError(403, "forbidden", "API key thiếu quyền posts:publish để xuất bản.");
    }
    if (requested === "scheduled" && !scheduledAt) {
      throw new ApiError(400, "validation_error", "scheduled_at là bắt buộc khi status=scheduled.", [
        { path: "scheduled_at", message: "Thiếu thời điểm xuất bản." },
      ]);
    }
    return { status: requested, demoted: false, scheduledAt: requested === "scheduled" ? scheduledAt : null };
  }
  if (requested === "archived") {
    if (!hasScope(client, "posts:publish")) throw new ApiError(403, "forbidden", "API key thiếu quyền posts:publish để lưu trữ.");
    if (client.publish_mode === "review") throw new ApiError(403, "publish_mode_review", "Client chờ duyệt không thể lưu trữ.");
  }
  return { status: requested, demoted: false, scheduledAt: null };
}

function ifMatchVersion(c, post) {
  const raw = String(c.req.header("if-match") || "").trim();
  if (!raw) {
    if (c.env.REQUIRE_IF_MATCH === "1") {
      throw new ApiError(428, "precondition_required", "Cần gửi If-Match với version hiện tại trước khi sửa bài.", [
        { path: "If-Match", message: `Version hiện tại: ${post.version}` },
      ]);
    }
    return null;
  }
  if (raw === "*") return Number(post.version);
  const match = /^(?:W\/)?"?v?(\d+)"?$/.exec(raw);
  if (!match) throw new ApiError(400, "validation_error", "If-Match phải là version dạng \"v3\" hoặc số.");
  return Number(match[1]);
}

function setEtag(c, body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.data?.version) c.header("ETag", `"v${parsed.data.version}"`);
  } catch {
    // response already sent in non-JSON form
  }
}

function conflictResponse(c, post, currentVersion = post.version) {
  c.header("ETag", `"v${currentVersion}"`);
  throw new ApiError(
    412,
    "version_conflict",
    "Bài viết đã được cập nhật ở phiên bản khác.",
    [{ path: "If-Match", message: `Version hiện tại: ${currentVersion}` }],
    { current_version: Number(currentVersion) },
  );
}

function requireContent(status, content) {
  if (["review", "published", "scheduled"].includes(status) && String(content || "").trim().length < 20) {
    throw new ApiError(400, "validation_error", "Nội dung cần tối thiểu 20 ký tự để gửi duyệt hoặc xuất bản.", [
      { path: "content", message: "Nội dung quá ngắn." },
    ]);
  }
}

function checkContentSize(content) {
  if (String(content || "").length > MAX_CONTENT_CHARS) {
    throw new ApiError(
      413,
      "payload_too_large",
      `Nội dung vượt giới hạn ${MAX_CONTENT_CHARS} ký tự của staging Free Plan.`,
      [{ path: "content", message: "Rút gọn nội dung hoặc chia nhỏ." }],
    );
  }
}

async function requireCategory(db, value) {
  if (!value) return null;
  const category = await data.resolveApiCategory(db, value);
  if (!category) {
    throw new ApiError(400, "validation_error", "Chuyên mục không tồn tại.", [
      { path: "category", message: `Không tìm thấy chuyên mục “${value}”.` },
    ]);
  }
  return category;
}

async function sanitize(c, content, format) {
  return (await doStub(c, "sanitize").sanitize(content, format === "markdown" ? "markdown" : "html")).html;
}

function publishMeta(client, demoted, key = null) {
  return { publish_mode: client.publish_mode, publish_demoted: demoted, ...(key ? { idempotency_key: key } : {}) };
}

async function idempotencyState(c, client) {
  const key = String(c.req.header("idempotency-key") || "").trim();
  if (!key) return null;
  if (key.length > 200 || !/^[\x20-\x7E]+$/.test(key)) {
    throw new ApiError(400, "validation_error", "Idempotency-Key không hợp lệ (tối đa 200 ký tự ASCII).");
  }
  if (key.length) {
    const path = c.req.path;
    const body = c.get("jsonBody") || {};
    const requestHash = await sha256Hex(JSON.stringify(body));
    const existing = await getIdempotent(c.env.DB, client.id, key, c.req.method, path);
    return { key, path, requestHash, existing };
  }
  return null;
}

function replay(c, state) {
  if (!state?.existing) return null;
  if (state.existing.request_hash !== state.requestHash) {
    throw new ApiError(409, "idempotency_conflict", "Idempotency-Key đã được dùng với nội dung khác.", [
      { path: "Idempotency-Key", message: "Payload không khớp với request trước." },
    ]);
  }
  c.header("Idempotent-Replayed", "true");
  return c.body(state.existing.response_body, state.existing.status_code, { "content-type": "application/json" });
}

async function store(c, state, status, payload) {
  if (!state?.key) return;
  await saveIdempotent(
    c.env.DB,
    c.get("client").id,
    state.key,
    c.req.method,
    state.path,
    state.requestHash,
    status,
    JSON.stringify(payload),
  );
}

async function audit(c, action, entityId, meta = {}, entityType = "post") {
  await data.logAudit(c.env.DB, {
    actorType: "api",
    actorId: c.get("client").id,
    action,
    entityType,
    entityId,
    meta,
    ip: requestIp(c),
    userAgent: c.req.header("user-agent") || "",
  });
}

async function loadPost(c, id, { allowDeleted = false } = {}) {
  const post = await data.getAdminPost(c.env.DB, id);
  if (!post) throw new ApiError(404, "not_found", "Bài viết không tồn tại.");
  if (post.deleted_at && !allowDeleted) throw new ApiError(410, "gone", "Bài viết đã bị xóa.");
  return post;
}

function requireAuto(c) {
  const client = c.get("client");
  if (client.publish_mode !== "auto") {
    throw new ApiError(403, "publish_mode_review", "API client đang ở chế độ chờ duyệt, không thể xuất bản trực tiếp.");
  }
}

export function registerApiV1Routes(app) {
  const api = new Hono();

  api.onError((error, c) => {
    if (error instanceof ApiError) {
      return jsonError(c, error.status, error.code, error.message, error.details, error.extra);
    }
    console.error("api.v1.error", error);
    return jsonError(c, 500, "internal_error", "Máy chủ gặp sự cố khi xử lý yêu cầu.");
  });

  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Request-Id", crypto.randomUUID());
    const length = Number(c.req.header("content-length") || 0);
    if (length > 1024 * 1024 && ["POST", "PATCH", "PUT"].includes(c.req.method)) {
      return jsonError(c, 413, "payload_too_large", "Request body vượt quá 1 MB.");
    }
    if (["POST", "PATCH", "PUT"].includes(c.req.method) && (c.req.header("content-type") || "").includes("application/json")) {
      c.set("jsonBody", await c.req.json().catch(() => null));
    }
    await next();
  });

  api.get("/health", async (c) => {
    try {
      await c.env.DB.prepare("SELECT 1 AS ok").first();
      return c.json({ status: "ok", time: new Date().toISOString() });
    } catch {
      return c.json({ status: "error" }, 503);
    }
  });

  api.get("/openapi.yaml", async (c) => {
    const response = await c.env.ASSETS.fetch(new Request(new URL("/openapi.yaml", c.req.url)));
    if (!response.ok) return jsonError(c, 404, "not_found", "Chưa có tài liệu OpenAPI.");
    return new Response(response.body, {
      status: 200,
      headers: { "content-type": "text/yaml; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  });

  api.use("*", async (c, next) => {
    if (c.req.query("api_key") || c.req.query("key") || c.req.query("token")) {
      return jsonError(c, 400, "validation_error", "Không gửi API key trong URL. Dùng Authorization: Bearer <key>.");
    }
    const match = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") || "");
    if (!match) {
      c.header("WWW-Authenticate", 'Bearer realm="mh-api"');
      return jsonError(c, 401, "unauthorized", "Thiếu Authorization: Bearer <key>.");
    }
    const client = await verifyApiKey(c.env.DB, match[1]);
    if (!client) {
      c.header("WWW-Authenticate", 'Bearer realm="mh-api", error="invalid_token"');
      return jsonError(c, 401, "unauthorized", "API key không hợp lệ hoặc đã bị thu hồi.");
    }
    const ipLimit = await doStub(c, "rate").rateLimit(`api-ip:${requestIp(c)}`, 300, 60_000);
    if (!ipLimit.allowed) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((ipLimit.reset - Date.now()) / 1000))));
      return jsonError(c, 429, "rate_limited", "Quá nhiều yêu cầu API từ địa chỉ này.");
    }
    const max = Math.max(10, client.rate_limit_per_min || 60);
    const limit = await doStub(c, "rate").rateLimit(`api:${client.id}`, max, 60_000);
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(limit.remaining));
    if (!limit.allowed) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))));
      return jsonError(c, 429, "rate_limited", "API key vượt quá giới hạn request/phút.");
    }
    c.set("client", client);
    await next();
  });

  api.get("/me", (c) => {
    const client = c.get("client");
    return c.json({
      data: {
        id: client.id,
        name: client.name,
        scopes: client.scopes,
        publish_mode: client.publish_mode,
        rate_limit_per_min: client.rate_limit_per_min,
        last_used_at: client.last_used_at || null,
        created_at: client.created_at,
      },
    });
  });

  api.get("/categories", async (c) => {
    const client = c.get("client");
    if (!["taxonomy:read", "posts:read", "posts:write"].some((scope) => hasScope(client, scope))) {
      throw new ApiError(403, "forbidden", "API key thiếu quyền taxonomy:read/posts:read.");
    }
    const categories = await data.listAdminCategories(c.env.DB);
    return c.json({
      data: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        group: category.group_name,
        description: category.description,
        published_posts: category.post_count,
      })),
    });
  });

  api.get("/tags", async (c) => {
    const client = c.get("client");
    if (!["taxonomy:read", "posts:read", "posts:write"].some((scope) => hasScope(client, scope))) {
      throw new ApiError(403, "forbidden", "API key thiếu quyền taxonomy:read/posts:read.");
    }
    const tags = await data.listAdminTags(c.env.DB);
    return c.json({
      data: tags.map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug, published_posts: tag.post_count })),
    });
  });

  api.get("/posts", async (c) => {
    requireScope(c, "posts:read");
    const status = String(c.req.query("status") || "");
    if (status && !STATUSES.includes(status)) {
      throw new ApiError(400, "validation_error", "status không hợp lệ.", [
        { path: "status", message: `Giá trị hợp lệ: ${STATUSES.join(", ")}` },
      ]);
    }
    const category = c.req.query("category") ? await requireCategory(c.env.DB, c.req.query("category")) : null;
    const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query("limit"), 10) || 20));
    const offset = Math.max(0, Number.parseInt(c.req.query("offset"), 10) || 0);
    const q = String(c.req.query("q") || "").slice(0, 100);
    const result = await data.listApiPosts(c.env.DB, {
      status,
      categoryId: category?.id || "",
      q,
      limit,
      offset,
    });
    return c.json({
      data: result.items.map((post) => serializePost(post, { includeHtml: false, includeContent: false })),
      pagination: {
        total: result.total,
        limit,
        offset,
        has_more: offset + result.items.length < result.total,
      },
    });
  });

  api.get("/posts/slug/:slug", async (c) => {
    requireScope(c, "posts:read");
    const post = await data.getApiPostBySlug(c.env.DB, c.req.param("slug"));
    if (!post) throw new ApiError(404, "not_found", "Bài viết không tồn tại.");
    if (post.deleted_at) throw new ApiError(410, "gone", "Bài viết đã bị xóa.");
    c.header("ETag", `"v${post.version}"`);
    return c.json({ data: serializePost(post) });
  });

  api.get("/posts/:id", async (c) => {
    requireScope(c, "posts:read");
    const post = await loadPost(c, c.req.param("id"));
    c.header("ETag", `"v${post.version}"`);
    return c.json({ data: serializePost(post) });
  });

  api.post("/posts", async (c) => {
    requireScope(c, "posts:write");
    const client = c.get("client");
    const state = await idempotencyState(c, client);
    const { createPostSchema } = await import("./api-schemas.js");
    const parsed = parseBody(c, createPostSchema);
    let coverMedia = null;
    if (parsed.cover_media_id) {
      const resolved = await resolveCoverMedia(c.env, parsed.cover_media_id);
      if (resolved.error) throw new ApiError(resolved.error.status, resolved.error.code, resolved.error.message);
      coverMedia = resolved.data;
    }
    checkContentSize(parsed.content || "");
    const requested = parsed.status || "draft";
    const scheduledAt = parsed.scheduled_at ? parseDate(parsed.scheduled_at, { future: requested === "scheduled" }) : null;
    const decision = resolveStatus(client, requested, { scheduledAt });
    const format = parsed.content_format || "markdown";
    const content = parsed.content || "";
    requireContent(decision.status, content);
    const category = parsed.category ? await requireCategory(c.env.DB, parsed.category) : null;
    const authorId = await data.defaultApiAuthorId(c.env.DB);
    if (!authorId) throw new ApiError(503, "no_author", "Chưa có tài khoản tác giả để gán bài viết.");
    const seo = parsed.seo || {};
    const contentPayload = {
      title: parsed.title,
      slug: parsed.slug || "",
      excerpt: parsed.excerpt || "",
      lede: parsed.lede || "",
      contentSource: content,
      contentFormat: format,
      status: decision.status,
      categoryId: category?.id || null,
      authorId,
      coverImage: coverMedia?.url || parsed.cover_image || "",
      coverAlt: parsed.cover_alt || coverMedia?.alt || "",
      coverCaption: parsed.cover_caption || "",
      seoTitle: seo.title || "",
      seoDescription: seo.description || parsed.excerpt || "",
      focusKeyword: seo.focus_keyword || "",
      canonicalUrl: seo.canonical_url || "",
      ogImage: seo.og_image || parsed.cover_image || "",
      isFeatured: Boolean(parsed.is_featured),
      readMinutes: parsed.read_minutes || undefined,
      scheduledAt: decision.status === "scheduled" ? scheduledAt : null,
      tags: parsed.tags || [],
      externalId: parsed.external_id || null,
      demoted: decision.demoted,
    };
    const result = await doStub(c, `content:${client.id}`).apiCreatePost({
      clientId: client.id,
      clientPublishMode: client.publish_mode,
      data: contentPayload,
      idem: state ? { key: state.key, path: state.path, requestHash: state.requestHash } : null,
    });
    if (result.replay) c.header("Idempotent-Replayed", "true");
    setEtag(c, result.body);
    return c.body(result.body, result.status, { "content-type": "application/json" });
  });

  api.patch("/posts/:id", async (c) => {
    requireScope(c, "posts:write");
    const client = c.get("client");
    const state = await idempotencyState(c, client);
    const post = await loadPost(c, c.req.param("id"));
    if (post.status === "published" && !hasScope(client, "posts:publish")) {
      throw new ApiError(403, "forbidden", "Cần quyền posts:publish để sửa bài đã xuất bản.");
    }
    const { updatePostSchema } = await import("./api-schemas.js");
    const parsed = parseBody(c, updatePostSchema);
    let coverMedia = null;
    if (parsed.cover_media_id) {
      const resolved = await resolveCoverMedia(c.env, parsed.cover_media_id);
      if (resolved.error) throw new ApiError(resolved.error.status, resolved.error.code, resolved.error.message);
      coverMedia = resolved.data;
    }
    if (parsed.content !== undefined) checkContentSize(parsed.content);
    const patch = {};
    if (parsed.title !== undefined) patch.title = parsed.title;
    if (parsed.slug !== undefined) patch.slug = parsed.slug;
    if (parsed.excerpt !== undefined) patch.excerpt = parsed.excerpt;
    if (parsed.lede !== undefined) patch.lede = parsed.lede;
    if (parsed.tags !== undefined) patch.tags = parsed.tags;
    if (parsed.is_featured !== undefined) patch.isFeatured = parsed.is_featured;
    if (parsed.read_minutes !== undefined) patch.readMinutes = parsed.read_minutes;
    if (parsed.category !== undefined) patch.categoryId = parsed.category ? (await requireCategory(c.env.DB, parsed.category))?.id || null : null;
    if (coverMedia) patch.coverImage = coverMedia.url;
    else if (parsed.cover_image !== undefined) patch.coverImage = parsed.cover_image;
    if (parsed.cover_alt !== undefined) patch.coverAlt = parsed.cover_alt;
    else if (coverMedia?.alt) patch.coverAlt = coverMedia.alt;
    if (parsed.cover_caption !== undefined) patch.coverCaption = parsed.cover_caption;
    if (parsed.seo) {
      if (parsed.seo.title !== undefined) patch.seoTitle = parsed.seo.title;
      if (parsed.seo.description !== undefined) patch.seoDescription = parsed.seo.description;
      if (parsed.seo.focus_keyword !== undefined) patch.focusKeyword = parsed.seo.focus_keyword;
      if (parsed.seo.canonical_url !== undefined) patch.canonicalUrl = parsed.seo.canonical_url;
      if (parsed.seo.og_image !== undefined) patch.ogImage = parsed.seo.og_image;
    }
    if (parsed.content !== undefined) {
      patch.contentSource = parsed.content;
      patch.contentFormat = parsed.content_format || post.content_format;
    }
    let demoted = false;
    let effectiveStatus = post.status;
    if (parsed.status !== undefined) {
      const scheduledAt =
        parsed.scheduled_at !== undefined
          ? parseDate(parsed.scheduled_at, { future: parsed.status === "scheduled" })
          : parsed.status === "scheduled" && post.scheduled_at
            ? parseDate(post.scheduled_at, { future: true })
            : null;
      const decision = resolveStatus(client, parsed.status, { scheduledAt });
      patch.status = decision.status;
      patch.scheduledAt = decision.status === "scheduled" ? scheduledAt : null;
      demoted = decision.demoted;
      effectiveStatus = decision.status;
    } else if (parsed.scheduled_at !== undefined && post.status === "scheduled") {
      patch.scheduledAt = parseDate(parsed.scheduled_at, { future: true });
    }
    const effectiveContent = parsed.content !== undefined ? parsed.content : post.content_source || "";
    requireContent(effectiveStatus, effectiveContent);
    patch.demoted = demoted;
    const result = await doStub(c, `content:${client.id}`).apiUpdatePost({
      clientId: client.id,
      clientPublishMode: client.publish_mode,
      postId: post.id,
      patch,
      expectedVersion: ifMatchVersion(c, post),
      idem: state ? { key: state.key, path: state.path, requestHash: state.requestHash } : null,
    });
    if (result.replay) c.header("Idempotent-Replayed", "true");
    setEtag(c, result.body);
    return c.body(result.body, result.status, { "content-type": "application/json" });
  });

  api.post("/posts/:id/publish", async (c) => {
    requireAuto(c);
    requireScope(c, "posts:publish");
    const client = c.get("client");
    const state = await idempotencyState(c, client);
    const replayResponse = replay(c, state);
    if (replayResponse) return replayResponse;
    const post = await loadPost(c, c.req.param("id"));
    requireContent("published", post.content_source);
    const expectedVersion = ifMatchVersion(c, post);
    let updated;
    try {
      updated = await data.updateAdminPost(c.env.DB, post.id, { status: "published" }, { actorType: "api", actorId: client.id }, { expectedVersion });
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") conflictResponse(c, post, error.currentVersion || post.version);
      if (error.code === "MEDIA_NOT_READY") return jsonError(c, 409, "media_not_ready", error.message, error.urls?.map((url) => ({ path: "media", message: url })) || null);
      throw error;
    }
    await audit(c, "api.post_published", updated.id, { slug: updated.slug });
    const payload = { data: serializePost(updated), meta: publishMeta(client, false, state?.key) };
    await store(c, state, 200, payload);
    c.header("ETag", `"v${updated.version}"`);
    return c.json(payload);
  });

  api.post("/posts/:id/schedule", async (c) => {
    requireAuto(c);
    requireScope(c, "posts:publish");
    const client = c.get("client");
    const state = await idempotencyState(c, client);
    const replayResponse = replay(c, state);
    if (replayResponse) return replayResponse;
    const post = await loadPost(c, c.req.param("id"));
    const { scheduleSchema } = await import("./api-schemas.js");
    const parsed = parseBody(c, scheduleSchema);
    const scheduledAt = parseDate(parsed.scheduled_at, { future: true });
    requireContent("scheduled", post.content_source);
    const expectedVersion = ifMatchVersion(c, post);
    let updated;
    try {
      updated = await data.updateAdminPost(
        c.env.DB,
        post.id,
        { status: "scheduled", scheduledAt },
        { actorType: "api", actorId: client.id },
        { expectedVersion },
      );
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") conflictResponse(c, post, error.currentVersion || post.version);
      if (error.code === "MEDIA_NOT_READY") return jsonError(c, 409, "media_not_ready", error.message, error.urls?.map((url) => ({ path: "media", message: url })) || null);
      throw error;
    }
    await audit(c, "api.post_scheduled", updated.id, { slug: updated.slug, scheduled_at: scheduledAt });
    const payload = { data: serializePost(updated), meta: publishMeta(client, false, state?.key) };
    await store(c, state, 200, payload);
    c.header("ETag", `"v${updated.version}"`);
    return c.json(payload);
  });

  api.post("/posts/:id/unpublish", async (c) => {
    requireAuto(c);
    requireScope(c, "posts:publish");
    const client = c.get("client");
    const state = await idempotencyState(c, client);
    const replayResponse = replay(c, state);
    if (replayResponse) return replayResponse;
    const post = await loadPost(c, c.req.param("id"));
    const { unpublishSchema } = await import("./api-schemas.js");
    const parsed = parseBody(c, unpublishSchema);
    const target = parsed.status || "draft";
    const expectedVersion = ifMatchVersion(c, post);
    let updated;
    try {
      updated = await data.updateAdminPost(c.env.DB, post.id, { status: target }, { actorType: "api", actorId: client.id }, { expectedVersion });
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") conflictResponse(c, post, error.currentVersion || post.version);
      throw error;
    }
    await audit(c, "api.post_unpublished", updated.id, { slug: updated.slug, status: target });
    const payload = { data: serializePost(updated), meta: publishMeta(client, false, state?.key) };
    await store(c, state, 200, payload);
    c.header("ETag", `"v${updated.version}"`);
    return c.json(payload);
  });

  api.delete("/posts/:id", async (c) => {
    requireAuto(c);
    requireScope(c, "posts:publish");
    const client = c.get("client");
    const post = await loadPost(c, c.req.param("id"), { allowDeleted: true });
    if (!post.deleted_at) {
      const expectedVersion = ifMatchVersion(c, post);
      try {
        await data.softDeleteAdminPost(c.env.DB, post.id, { expectedVersion });
      } catch (error) {
        if (error.code === "VERSION_CONFLICT") conflictResponse(c, post, error.currentVersion || post.version);
        throw error;
      }
      await audit(c, "api.post_deleted", post.id, { slug: post.slug });
    }
    return c.json({ data: { id: post.id, deleted: true } });
  });

  api.post("/media", async (c) => {
    requireScope(c, "media:write");
    return jsonError(c, 501, "media_static_deploy_required", "Static Assets không nhận binary upload trực tiếp. Dùng trusted deploy runner và cover_media_id sau khi ảnh READY.");
  });

  api.notFound((c) => jsonError(c, 404, "not_found", "API endpoint không tồn tại."));
  app.route("/api/v1", api);
}
