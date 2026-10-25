import fs from "node:fs";
import { spawnSync } from "node:child_process";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const seed = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const extra = JSON.parse(fs.readFileSync("fixtures/extra-meta.json", "utf8"));
const stagingToken = fs.readFileSync(".staging-token", "utf8").trim();
const stamp = Date.now().toString(36);
const prefix = `m3qa-${stamp}`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function api(path, { method = "GET", key, body, headers = {} } = {}) {
  let last;
  const requestHeaders = { ...headers };
  const mutation = ["PATCH", "DELETE"].includes(method) || (method === "POST" && /\/posts\/[^/]+\/(publish|schedule|unpublish)$/.test(path));
  if (mutation && !requestHeaders["if-match"]) {
    const id = /\/posts\/([^/?]+)/.exec(path)?.[1];
    if (id) {
      const current = await fetch(BASE + `/api/v1/posts/${id}`, {
        headers: { "user-agent": "Mozilla/5.0 M3-API-Test", authorization: `Bearer ${key}` },
      });
      const etag = current.headers.get("etag");
      if (etag) requestHeaders["if-match"] = etag;
    }
  }
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        method,
        headers: {
          "user-agent": "Mozilla/5.0 M3-API-Test",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...requestHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // non-json
      }
      return { response, text, json };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
    }
  }
  throw last;
}

function d1(sql, json = false) {
  if (json) {
    const result = spawnSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "meohay-m0-stg-230403", "--remote", "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--command", sql, "--json"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
  }
  const file = `fixtures/.${prefix}.sql`;
  fs.writeFileSync(file, sql);
  const result = spawnSync("npx.cmd", ["wrangler", "d1", "execute", "meohay-m0-stg-230403", "--remote", "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--file", file], { encoding: "utf8", shell: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

const health = await api("/api/v1/health");
check("API health", health.response.status === 200 && health.json?.status === "ok");
const openapi = await api("/api/v1/openapi.yaml");
check("OpenAPI served", openapi.response.status === 200 && openapi.text.includes("/api/v1/posts") || openapi.text.includes("/posts:"));
const noKey = await api("/api/v1/posts");
check("API requires key", noKey.response.status === 401);
const me = await api("/api/v1/me", { key: seed.apiKey });
check("API me", me.response.status === 200 && me.json?.data?.publish_mode === "auto");
const cats = await api("/api/v1/categories", { key: seed.apiKey });
check("API categories", cats.response.status === 200 && Array.isArray(cats.json?.data));
const tags = await api("/api/v1/tags", { key: seed.apiKey });
check("API tags", tags.response.status === 200 && Array.isArray(tags.json?.data));

const idemKey = `${prefix}-idem`;
const createBody = {
  title: `M3 API ${stamp}`,
  slug: prefix,
  excerpt: "M3 API test",
  lede: "M3 API lede",
  content: `## M3 API\n\nNoi dung kiểm thử API ${stamp}.\n\n<script>alert(1)</script>`,
  content_format: "markdown",
  category: "wifi-mang",
  tags: [`${prefix}-tag`],
  status: "draft",
  external_id: `${prefix}-ext`,
};
const create = await api("/api/v1/posts", { method: "POST", key: seed.apiKey, headers: { "idempotency-key": idemKey }, body: createBody });
const postId = create.json?.data?.id;
check("API create draft", create.response.status === 201 && Boolean(postId), `status=${create.response.status}`);
check("API create sanitizes", !String(create.json?.data?.content_html || "").includes("<script"));
const replay = await api("/api/v1/posts", { method: "POST", key: seed.apiKey, headers: { "idempotency-key": idemKey }, body: createBody });
check("API idempotency replay", replay.response.status === 201 && replay.response.headers.get("idempotent-replayed") === "true");
const conflict = await api("/api/v1/posts", { method: "POST", key: seed.apiKey, headers: { "idempotency-key": idemKey }, body: { ...createBody, title: "Different title" } });
check("API idempotency conflict", conflict.response.status === 409 && conflict.json?.error?.code === "idempotency_conflict");
const extReplay = await api("/api/v1/posts", { method: "POST", key: seed.apiKey, headers: { "idempotency-key": `${prefix}-ext-key` }, body: { ...createBody, slug: `${prefix}-second` } });
check("API external_id replay", extReplay.response.status === 200 && extReplay.json?.meta?.external_id_replayed === true);
const getById = await api(`/api/v1/posts/${postId}`, { key: seed.apiKey });
check("API get by id", getById.response.status === 200 && getById.json?.data?.id === postId);
const getBySlug = await api(`/api/v1/posts/slug/${prefix}`, { key: seed.apiKey });
check("API get by slug", getBySlug.response.status === 200 && getBySlug.json?.data?.slug === prefix);
const list = await api("/api/v1/posts?limit=5", { key: seed.apiKey });
check("API list", list.response.status === 200 && Array.isArray(list.json?.data) && list.json?.pagination?.limit === 5);

const publish = await api(`/api/v1/posts/${postId}/publish`, { method: "POST", key: seed.apiKey });
check("API publish", publish.response.status === 200 && publish.json?.data?.status === "published");
const publicPost = await fetch(BASE + `/bai-viet/${prefix}`, { headers: { "user-agent": "Mozilla/5.0 M3-API-Test" } });
check("API published visible", publicPost.status === 200);
const update = await api(`/api/v1/posts/${postId}`, { method: "PATCH", key: seed.apiKey, body: { title: `M3 API ${stamp} updated`, content: "## Updated\n\nNoi dung updated du dai de publish hop le." } });
check("API update", update.response.status === 200 && update.json?.data?.title.includes("updated"));

const scheduledSlug = `${prefix}-scheduled`;
const scheduled = await api("/api/v1/posts", {
  method: "POST",
  key: seed.apiKey,
  body: {
    title: `M3 scheduled ${stamp}`,
    slug: scheduledSlug,
    content: "## Scheduled\n\nNoi dung scheduled du dai de publish hop le.",
    content_format: "markdown",
    category: "wifi-mang",
    status: "scheduled",
    scheduled_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  },
});
const scheduledId = scheduled.json?.data?.id;
check("API schedule", scheduled.response.status === 201 && scheduled.json?.data?.status === "scheduled");
d1(`UPDATE posts SET scheduled_at='${new Date(Date.now() - 60_000).toISOString()}' WHERE id='${scheduledId}';`);
const cron = await fetch(BASE + "/api/m0/cron/run", { method: "POST", headers: { "x-staging-token": stagingToken } });
check("API scheduled publishes via cron", cron.status === 200 && (await fetch(BASE + `/bai-viet/${scheduledSlug}`)).status === 200);

const unpublish = await api(`/api/v1/posts/${postId}/unpublish`, { method: "POST", key: seed.apiKey, body: { status: "draft" } });
check("API unpublish", unpublish.response.status === 200 && unpublish.json?.data?.status === "draft");
check("API unpublished hidden", (await fetch(BASE + `/bai-viet/${prefix}`)).status === 404);
const removed = await api(`/api/v1/posts/${postId}`, { method: "DELETE", key: seed.apiKey });
check("API soft delete", removed.response.status === 200);
check("API deleted returns 410", (await api(`/api/v1/posts/${postId}`, { key: seed.apiKey })).response.status === 410);

const review = await api("/api/v1/posts", {
  method: "POST",
  key: seed.reviewKey,
  body: {
    title: `M3 review ${stamp}`,
    slug: `${prefix}-review`,
    content: "## Review\n\nNoi dung review du dai de gui duyet.",
    content_format: "markdown",
    status: "published",
  },
});
check("API review demotes publish", review.response.status === 201 && review.json?.data?.status === "review" && review.json?.meta?.publish_demoted === true);
const reviewPublish = await api(`/api/v1/posts/${review.json?.data?.id}/publish`, { method: "POST", key: seed.reviewKey });
check("API review cannot publish", reviewPublish.response.status === 403 && reviewPublish.json?.error?.code === "publish_mode_review");
const lowCreate = await api("/api/v1/posts", { method: "POST", key: extra.lowRateKey, body: { title: "No write", content: "No write content long enough." } });
check("API scope read-only create denied", lowCreate.response.status === 403);
const large = await api("/api/v1/posts", { method: "POST", key: seed.apiKey, body: { title: "Large", content: "x".repeat(200_001) } });
check("API content over contract limit rejected", large.response.status === 400 && large.json?.error?.code === "validation_error");
const media = await api("/api/v1/media", { method: "POST", key: seed.apiKey });
check("API media blocked", media.response.status === 501 && ["media_not_configured", "media_static_deploy_required"].includes(media.json?.error?.code));

d1(`
DELETE FROM posts_fts WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${prefix}%');
DELETE FROM post_tags WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${prefix}%');
DELETE FROM revisions WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${prefix}%');
DELETE FROM slug_history WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${prefix}%');
DELETE FROM posts WHERE slug LIKE '${prefix}%';
DELETE FROM tags WHERE slug LIKE '${prefix}%';
DELETE FROM idempotency_keys WHERE client_id='client-m0-auto' AND idem_key LIKE '${prefix}%';
`);

const failed = results.filter((item) => !item.ok);
fs.writeFileSync(`fixtures/m3-api-test-${stamp}.json`, JSON.stringify({ results, passed: results.length - failed.length, failed: failed.length }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
