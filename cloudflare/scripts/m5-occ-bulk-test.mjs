import fs from "node:fs";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const seed = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
const stagingToken = fs.readFileSync(".staging-token", "utf8").trim();
const cfEnv = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const workerConfig = JSON.parse(fs.readFileSync("wrangler.remote.jsonc", "utf8"));
const databaseId = workerConfig.d1_databases[0].database_id;
const stamp = Date.now().toString(36);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

class Jar {
  cookie = "";
  update(response) {
    const map = new Map(this.cookie.split("; ").filter(Boolean).map((item) => [item.split("=")[0], item]));
    for (const raw of response.headers.getSetCookie?.() || []) {
      const pair = raw.split(";")[0];
      const key = pair.split("=")[0];
      if (pair.endsWith("=")) map.delete(key);
      else map.set(key, pair);
    }
    this.cookie = [...map.values()].join("; ");
  }
}

async function request(jar, path, { method = "GET", body, headers = {}, form = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        method,
        headers: {
          "user-agent": "Mozilla/5.0 M5-OCC-Bulk",
          ...(jar?.cookie ? { cookie: jar.cookie } : {}),
          ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...headers,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (jar) jar.update(response);
      return { response, text: await response.text() };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function csrfFrom(text) {
  return /name="_csrf" value="([^"]+)"/.exec(text)?.[1] || "";
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${seed.apiKey}`,
      "user-agent": "Mozilla/5.0 M5-OCC-Bulk",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json
  }
  return { status: response.status, json, text, etag: response.headers.get("etag") };
}

async function d1(sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfEnv.CLOUDFLARE_ACCOUNT_ID}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfEnv.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(JSON.stringify(payload.errors || payload));
  return payload.result?.[0]?.results || [];
}

const jar = new Jar();

async function cleanupTestPosts() {
  const match = "(slug LIKE 'm5-occ-%' OR slug LIKE 'm5-strict-check-%')";
  await d1(`DELETE FROM post_tags WHERE post_id IN (SELECT id FROM posts WHERE ${match});
    DELETE FROM posts_fts WHERE post_id IN (SELECT id FROM posts WHERE ${match});
    DELETE FROM revisions WHERE post_id IN (SELECT id FROM posts WHERE ${match});
    DELETE FROM slug_history WHERE post_id IN (SELECT id FROM posts WHERE ${match});
    DELETE FROM media_usages WHERE post_id IN (SELECT id FROM posts WHERE ${match});
    DELETE FROM posts WHERE ${match};
    UPDATE categories SET cached_post_count=(SELECT COUNT(*) FROM posts p WHERE p.category_id=categories.id AND p.status='published' AND p.deleted_at IS NULL);
    UPDATE tags SET cached_post_count=(SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id=pt.post_id WHERE pt.tag_id=tags.id AND p.status='published' AND p.deleted_at IS NULL);
    DELETE FROM counters;
    INSERT INTO counters(key,value) VALUES ('published_posts',(SELECT COUNT(*) FROM posts WHERE status='published' AND deleted_at IS NULL))`);
}

await cleanupTestPosts();
const loginPage = await request(jar, "/admin/login");
const login = await request(jar, "/admin/login", {
  method: "POST",
  form: true,
  body: new URLSearchParams({ _csrf: csrfFrom(loginPage.text), email: creds.admin.email, password: creds.admin.password }),
});
check("admin login", login.response.status === 302, `status=${login.response.status}`);

let csrf = "";
async function adminToken(path = "/admin/posts") {
  const page = await request(jar, path);
  csrf = csrfFrom(page.text) || csrf;
  return page;
}
await adminToken();

async function adminPost(path, fields) {
  const params = new URLSearchParams({ _csrf: csrf });
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
    else params.set(key, String(value));
  }
  const response = await request(jar, path, {
    method: "POST",
    form: true,
    body: params,
  });
  return response;
}

async function createPost(label, status = "draft", extra = {}) {
  const response = await api("/api/v1/posts", {
    method: "POST",
    body: {
      title: `M5 OCC ${label} ${stamp}`,
      content: `## Nội dung\n\nBài kiểm thử M5 ${label} với nội dung đủ dài.`,
      status,
      ...extra,
    },
  });
  return response.json?.data;
}
async function getPost(id) {
  return api(`/api/v1/posts/${id}`);
}

// 1. Bulk requires version and applies CAS; preflight blocks stale batch before any write.
const a = await createPost("A");
const b = await createPost("B");
const c = await createPost("C");
check("test posts created", Boolean(a?.id && b?.id && c?.id));

const bulkPublish = await adminPost("/admin/posts/bulk/apply", {
  ids: [a.id, b.id, c.id],
  [`version-${a.id}`]: String(a.version),
  [`version-${b.id}`]: String(b.version),
  [`version-${c.id}`]: String(c.version),
  bulk_action: "publish",
  return_to: "/admin/posts",
});
check("bulk publish with versions", bulkPublish.response.status === 302, `status=${bulkPublish.response.status}`);
const publishedA = await getPost(a.id);
const publishedB = await getPost(b.id);
check("bulk publish applied", publishedA.json?.data?.status === "published" && publishedB.json?.data?.status === "published", `${publishedA.json?.data?.status}/${publishedB.json?.data?.status}`);

// Change A behind the admin page's back.
const changedA = await api(`/api/v1/posts/${a.id}`, {
  method: "PATCH",
  headers: { "if-match": `"v${publishedA.json.data.version}"` },
  body: { title: `M5 OCC A changed ${stamp}` },
});
check("API changes A to v+1", changedA.status === 200, `status=${changedA.status}`);

await adminToken("/admin/posts");
const staleBulk = await adminPost("/admin/posts/bulk/apply", {
  ids: [a.id, b.id],
  [`version-${a.id}`]: String(publishedA.json.data.version),
  [`version-${b.id}`]: String(publishedB.json.data.version),
  bulk_action: "draft",
  return_to: "/admin/posts",
});
check("bulk stale version rejected", staleBulk.response.status === 409, `status=${staleBulk.response.status}`);
const afterStaleA = await getPost(a.id);
const afterStaleB = await getPost(b.id);
check("stale bulk made no partial write", afterStaleA.json?.data?.title === `M5 OCC A changed ${stamp}` && afterStaleB.json?.data?.status === "published", `${afterStaleA.json?.data?.title} / ${afterStaleB.json?.data?.status}`);

await adminToken("/admin/posts");
const missingBulk = await adminPost("/admin/posts/bulk/apply", {
  ids: [b.id],
  bulk_action: "draft",
  return_to: "/admin/posts",
});
check("bulk missing version rejected", missingBulk.response.status === 409, `status=${missingBulk.response.status}`);

// 2. Single delete/restore/purge all require version; stale versions are rejected.
const currentB = (await getPost(b.id)).json.data;
await adminToken(`/admin/posts/${b.id}/edit`);
const deleteMissing = await adminPost(`/admin/posts/${b.id}/delete`, { return_to: "/admin/posts" });
check("delete without version rejected", deleteMissing.response.status === 409, `status=${deleteMissing.response.status}`);
await adminToken(`/admin/posts/${b.id}/edit`);
const deleteStale = await adminPost(`/admin/posts/${b.id}/delete`, { version: String(currentB.version - 1), return_to: "/admin/posts" });
check("delete stale version rejected", deleteStale.response.status === 409, `status=${deleteStale.response.status}`);
await adminToken(`/admin/posts/${b.id}/edit`);
const deleteOk = await adminPost(`/admin/posts/${b.id}/delete`, { version: String(currentB.version), return_to: "/admin/posts" });
check("delete current version succeeds", deleteOk.response.status === 302, `status=${deleteOk.response.status}`);
const deletedB = await getPost(b.id);
check("deleted post is gone", deletedB.status === 410, `status=${deletedB.status}`);

const deletedVersion = currentB.version + 1;
await adminToken("/admin/trash");
const restoreStale = await adminPost(`/admin/posts/${b.id}/restore`, { version: String(deletedVersion - 1) });
check("restore stale version rejected", restoreStale.response.status === 409, `status=${restoreStale.response.status}`);
await adminToken("/admin/trash");
const restoreOk = await adminPost(`/admin/posts/${b.id}/restore`, { version: String(deletedVersion) });
check("restore current version succeeds", restoreOk.response.status === 302, `status=${restoreOk.response.status}`);
const restoredB = await getPost(b.id);
check("restored version bumped", restoredB.status === 200 && restoredB.json?.data?.version === deletedVersion + 1, `version=${restoredB.json?.data?.version}`);

const restoredVersion = restoredB.json.data.version;
await adminToken(`/admin/posts/${b.id}/edit`);
await adminPost(`/admin/posts/${b.id}/delete`, { version: String(restoredVersion), return_to: "/admin/posts" });
const trashVersion = restoredVersion + 1;
await adminToken("/admin/trash");
const purgeMissing = await adminPost(`/admin/posts/${b.id}/purge`, {});
check("purge without version rejected", purgeMissing.response.status === 409, `status=${purgeMissing.response.status}`);
await adminToken("/admin/trash");
const purgeStale = await adminPost(`/admin/posts/${b.id}/purge`, { version: String(trashVersion - 1) });
check("purge stale version rejected", purgeStale.response.status === 409, `status=${purgeStale.response.status}`);
await adminToken("/admin/trash");
const purgeOk = await adminPost(`/admin/posts/${b.id}/purge`, { version: String(trashVersion) });
check("purge current version succeeds", purgeOk.response.status === 302, `status=${purgeOk.response.status}`);
const purgedB = await getPost(b.id);
check("purged post gone", purgedB.status === 404, `status=${purgedB.status}`);

// 3. Idempotency + version conflict.
const idemKey = `m5-idem-${stamp}`;
const idemBody = { title: `M5 OCC idem ${stamp}` };
const beforeIdem = await getPost(c.id);
const staleIdem = await api(`/api/v1/posts/${c.id}`, {
  method: "PATCH",
  headers: { "idempotency-key": idemKey, "if-match": '"v999"' },
  body: idemBody,
});
check("idempotent request with stale version rejected", staleIdem.status === 412 && staleIdem.json?.error?.code === "version_conflict", `status=${staleIdem.status}`);
const retryIdem = await api(`/api/v1/posts/${c.id}`, {
  method: "PATCH",
  headers: { "idempotency-key": idemKey, "if-match": `"v${beforeIdem.json.data.version}"` },
  body: idemBody,
});
check("retry after conflict succeeds", retryIdem.status === 200, `status=${retryIdem.status}`);
const replayIdem = await api(`/api/v1/posts/${c.id}`, {
  method: "PATCH",
  headers: { "idempotency-key": idemKey, "if-match": `"v${beforeIdem.json.data.version}"` },
  body: idemBody,
});
check("idempotency replay after success", replayIdem.status === 200 && replayIdem.json?.data?.version === retryIdem.json?.data?.version, `status=${replayIdem.status} version=${replayIdem.json?.data?.version}`);

// 4. Cron publish racing an API update: no lost content, version monotonic.
const due = new Date(Date.now() + 120_000).toISOString();
const cronPost = await createPost("CRON", "scheduled", { scheduled_at: due });
check("scheduled race post created", Boolean(cronPost?.id), `status=${cronPost?.status || "missing"} version=${cronPost?.version}`);
if (!cronPost?.id) {
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(1);
}
await d1(`UPDATE posts SET scheduled_at='${new Date(Date.now() - 60_000).toISOString()}' WHERE id='${cronPost.id}'`);
const raceVersion = (await getPost(cronPost.id)).json.data.version;
const [cronRun, racePatch] = await Promise.all([
  request(null, "/api/m0/cron/run", { method: "POST", headers: { "x-staging-token": stagingToken } }),
  api(`/api/v1/posts/${cronPost.id}`, {
    method: "PATCH",
    headers: { "if-match": `"v${raceVersion}"` },
    body: { title: `M5 OCC cron race ${stamp}` },
  }),
]);
const raced = await getPost(cronPost.id);
const patchApplied = racePatch.status === 200;
check("cron race returns consistent result", cronRun.response.status === 200 && (patchApplied || racePatch.status === 412), `cron=${cronRun.response.status} patch=${racePatch.status}`);
check("cron race publishes without losing content", raced.json?.data?.status === "published" && (patchApplied ? raced.json?.data?.title === `M5 OCC cron race ${stamp}` : true), `status=${raced.json?.data?.status} title=${raced.json?.data?.title}`);
check("cron race keeps version monotonic", raced.json?.data?.version > raceVersion, `before=${raceVersion} after=${raced.json?.data?.version}`);

// Cleanup test posts (API soft delete is enough for staging hygiene).
for (const post of [a, c, cronPost]) {
  if (!post?.id) continue;
  const current = await getPost(post.id);
  if (current.status === 200) {
    await api(`/api/v1/posts/${post.id}/delete`, {
      method: "DELETE",
      headers: { "if-match": `"v${current.json.data.version}"` },
    });
  }
}

await cleanupTestPosts();

const failed = results.filter((item) => !item.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
