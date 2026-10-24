import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  prepareEnv,
  startServer,
  stopServer,
  cleanupDir,
  seedUser,
  seedCategory,
  makeClient,
  getDb,
  PNG_1PX,
} from "./support.js";

const dir = prepareEnv("mh-api");
const ctx = await startServer();
const api = makeClient(ctx.base);

const admin = await seedUser({
  email: "admin@test.local",
  password: "AdminPass12345",
  name: "Quản trị",
  role: "admin",
});
await seedCategory({ name: "Wifi & Mạng", slug: "wifi-mang", group: "tech" });

const { createApiClient } = await import("../src/db/apikeys.js");
const autoClient = createApiClient({
  name: "Auto Client",
  scopes: ["posts:read", "posts:write", "posts:publish", "media:write", "taxonomy:read"],
  publishMode: "auto",
  rateLimitPerMin: 600,
});
const reviewClient = createApiClient({
  name: "Review Client",
  scopes: ["posts:read", "posts:write", "media:write"],
  publishMode: "review",
  rateLimitPerMin: 600,
});

async function apiRequest(path, { method = "GET", key, json, form, headers = {} } = {}) {
  const extra = { ...headers };
  if (key) extra.authorization = `Bearer ${key}`;
  return api.request(path, { method, json, multipart: form, headers: extra });
}

const runId = Date.now().toString(36);

after(async () => {
  await stopServer(ctx);
  cleanupDir(dir);
});

test("API requires a bearer key and rejects keys in query strings", async () => {
  const noKey = await api.request("/api/v1/posts");
  assert.equal(noKey.status, 401);
  assert.match(noKey.headers.get("www-authenticate"), /Bearer/);

  const inQuery = await api.request("/api/v1/posts?api_key=abc");
  assert.equal(inQuery.status, 400);

  const me = await apiRequest("/api/v1/me", { key: autoClient.key });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.name, "Auto Client");
});

test("review-mode client demotes publish requests to review", async () => {
  const res = await apiRequest("/api/v1/posts", {
    method: "POST",
    key: reviewClient.key,
    json: {
      title: "Bài API chờ duyệt",
      external_id: `ext-review-${runId}`,
      content: "Nội dung đủ dài cho bài kiểm thử API review mode.",
      content_format: "markdown",
      category: "wifi-mang",
      status: "published",
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.status, "review");
  assert.equal(res.json.meta.publish_demoted, true);

  const replay = await apiRequest("/api/v1/posts", {
    method: "POST",
    key: reviewClient.key,
    json: {
      title: "Bài API chờ duyệt",
      external_id: `ext-review-${runId}`,
      content: "Nội dung khác hoàn toàn nhưng cùng external_id.",
      content_format: "markdown",
      status: "published",
    },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.id, res.json.data.id);
  assert.equal(replay.json.meta.external_id_replayed, true);
});

test("idempotency replays a stored response and rejects payload changes", async () => {
  const body = {
    title: "Bài idempotency",
    content: "Nội dung đủ dài cho bài idempotency kiểm thử.",
    content_format: "markdown",
    status: "draft",
  };
  const first = await apiRequest("/api/v1/posts", {
    method: "POST",
    key: reviewClient.key,
    headers: { "idempotency-key": `idem-${runId}` },
    json: body,
  });
  assert.equal(first.status, 201);
  const second = await apiRequest("/api/v1/posts", {
    method: "POST",
    key: reviewClient.key,
    headers: { "idempotency-key": `idem-${runId}` },
    json: body,
  });
  assert.equal(second.status, 201);
  assert.equal(second.headers.get("idempotent-replayed"), "true");
  assert.equal(second.json.data.id, first.json.data.id);

  const conflict = await apiRequest("/api/v1/posts", {
    method: "POST",
    key: reviewClient.key,
    headers: { "idempotency-key": `idem-${runId}` },
    json: { ...body, title: "Payload khác" },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "idempotency_conflict");
});

test("auto client publishes sanitized Markdown and the public page is live", async () => {
  const res = await apiRequest("/api/v1/posts", {
    method: "POST",
    key: autoClient.key,
    json: {
      title: `Bài API tự động ${runId}`,
      content:
        "## Hướng dẫn\n\nNội dung **đậm** và <script>alert(1)</script> cùng <img src=x onerror=alert(1)>.",
      content_format: "markdown",
      category: "wifi-mang",
      status: "published",
      tags: ["api", "auto"],
      cover_image: "/assets/img/img-005.jpg",
      cover_alt: "Ảnh API",
      seo: { title: "SEO API", description: "Mô tả SEO API.", focus_keyword: "api" },
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.status, "published");
  assert.equal(/<script/i.test(res.json.data.content_html), false);
  assert.equal(/onerror/i.test(res.json.data.content_html), false);
  assert.match(res.json.data.content_html, /<strong>đậm<\/strong>/);

  const publicPage = await api.request(`/bai-viet/${res.json.data.slug}`);
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.text, /Bài API tự động/);

  const id = res.json.data.id;
  const patch = await apiRequest(`/api/v1/posts/${id}`, {
    method: "PATCH",
    key: autoClient.key,
    json: { title: "Bài API tự động (đã sửa)", seo: { title: "SEO đã sửa" } },
  });
  assert.equal(patch.status, 200);
  assert.match(patch.json.data.title, /đã sửa/);
  assert.equal(patch.json.data.seo.title, "SEO đã sửa");

  const schedule = await apiRequest(`/api/v1/posts/${id}/schedule`, {
    method: "POST",
    key: autoClient.key,
    json: { scheduled_at: new Date(Date.now() + 3600_000).toISOString() },
  });
  assert.equal(schedule.status, 200);
  assert.equal(schedule.json.data.status, "scheduled");

  const past = await apiRequest(`/api/v1/posts/${id}/schedule`, {
    method: "POST",
    key: autoClient.key,
    json: { scheduled_at: "2020-01-01T00:00:00.000Z" },
  });
  assert.equal(past.status, 400);

  const unpublish = await apiRequest(`/api/v1/posts/${id}/unpublish`, {
    method: "POST",
    key: autoClient.key,
    json: { status: "draft" },
  });
  assert.equal(unpublish.status, 200);
  assert.equal(unpublish.json.data.status, "draft");

  const remove = await apiRequest(`/api/v1/posts/${id}`, { method: "DELETE", key: autoClient.key });
  assert.equal(remove.status, 200);
  assert.equal((await apiRequest(`/api/v1/posts/${id}`, { key: autoClient.key })).status, 410);
});

test("review client cannot call publish endpoints", async () => {
  const list = await apiRequest("/api/v1/posts?status=review", { key: reviewClient.key });
  assert.equal(list.status, 200);
  assert.ok(list.json.data.length > 0);
  const id = list.json.data[0].id;
  const res = await apiRequest(`/api/v1/posts/${id}/publish`, {
    method: "POST",
    key: reviewClient.key,
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, "publish_mode_review");
});

test("validation errors are detailed and reject weak payloads", async () => {
  const res = await apiRequest("/api/v1/posts", {
    method: "POST",
    key: autoClient.key,
    json: { title: "x", content: "short" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, "validation_error");
  assert.ok(Array.isArray(res.json.error.details));
  assert.ok(res.json.error.details.some((item) => item.path === "title"));
});

test("list endpoint paginates and omits full content", async () => {
  const res = await apiRequest("/api/v1/posts?limit=1", { key: autoClient.key });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 1);
  assert.equal("content" in res.json.data[0], false);
  assert.ok(res.json.pagination.total >= 1);
});

test("media upload returns dimensions and a servable path", async () => {
  const form = new FormData();
  form.append("file", new Blob([PNG_1PX], { type: "image/png" }), "api-pixel.png");
  form.append("alt", "Pixel API");
  const res = await apiRequest("/api/v1/media", { method: "POST", key: autoClient.key, form });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.width, 1);
  assert.equal(res.json.data.height, 1);
  assert.match(res.json.data.path, /^\/media\//);
  const served = await api.request(res.json.data.path);
  assert.equal(served.status, 200);
});

test("per-client rate limit returns 429 and Retry-After", async () => {
  const limited = createApiClient({
    name: "Limited Client",
    scopes: ["posts:read"],
    publishMode: "review",
    rateLimitPerMin: 10,
  });
  let last;
  for (let i = 0; i < 11; i += 1) {
    last = await apiRequest("/api/v1/me", { key: limited.key });
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});

test("OpenAPI document is served", async () => {
  const res = await api.request("/api/v1/openapi.yaml");
  assert.equal(res.status, 200);
  assert.match(res.text, /openapi: 3\.1\.0/);
});
