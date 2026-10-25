import fs from "node:fs";
import { spawnSync } from "node:child_process";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const seed = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
const token = fs.readFileSync(".staging-token", "utf8").trim();
const stamp = Date.now().toString(36);
const prefix = `m4occ-${stamp}`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
async function api(path, { method = "GET", body, headers = {} } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        method,
        headers: { "user-agent": "Mozilla/5.0 M4-OCC", authorization: `Bearer ${seed.apiKey}`, ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
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
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw last;
}
function d1(sql, json = false) {
  if (json) {
    const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "meohay-m0-stg-230403", "--remote", "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--command", sql, "--json"], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
  }
  const file = `fixtures/.${prefix}.sql`;
  fs.writeFileSync(file, sql);
  const result = spawnSync("npx.cmd", ["wrangler", "d1", "execute", "meohay-m0-stg-230403", "--remote", "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--file", file], { encoding: "utf8", shell: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
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
async function request(jar, path, options = {}) {
  const response = await fetch(BASE + path, {
    ...options,
    headers: { "user-agent": "Mozilla/5.0 M4-OCC", ...(jar ? { cookie: jar.cookie } : {}), ...(options.headers || {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (jar) jar.update(response);
  return { response, text: await response.text() };
}
const csrfFrom = (text) => /name="_csrf" value="([^"]+)"/.exec(text)?.[1] || "";

await fetch(`${BASE}/api/m0/bench/reset-rate`, { method: "POST", headers: { "x-staging-token": token, "content-type": "application/json" }, body: "{}" });

const created = await api("/api/v1/posts", {
  method: "POST",
  body: {
    title: `M4 OCC ${stamp}`,
    slug: prefix,
    content: "## OCC\n\nNoi dung ban dau cho kiem thu version.",
    content_format: "markdown",
    status: "draft",
  },
});
const postId = created.json?.data?.id;
const version1 = created.json?.data?.version;
check("create returns version", created.response.status === 201 && version1 === 1 && created.response.headers.get("etag") === '"v1"', `status=${created.response.status} version=${version1}`);

const update1 = await api(`/api/v1/posts/${postId}`, {
  method: "PATCH",
  headers: { "if-match": '"v1"' },
  body: { title: `M4 OCC ${stamp} A`, content: "## OCC\n\nBan A du dai de cap nhat hop le." },
});
check("If-Match v1 update succeeds", update1.response.status === 200 && update1.json?.data?.version === 2, `status=${update1.response.status}`);
const stale = await api(`/api/v1/posts/${postId}`, {
  method: "PATCH",
  headers: { "if-match": '"v1"' },
  body: { title: `M4 OCC ${stamp} stale`, content: "## OCC\n\nBan stale du dai de cap nhat hop le." },
});
check("stale If-Match rejected", stale.response.status === 412 && stale.json?.error?.code === "version_conflict" && stale.json?.error?.details?.[0]?.message?.includes("2"), `status=${stale.response.status}`);

const parallel = await Promise.all([
  api(`/api/v1/posts/${postId}`, { method: "PATCH", headers: { "if-match": '"v2"' }, body: { title: `M4 OCC ${stamp} P1`, content: "## OCC\n\nParallel one du dai de cap nhat." } }),
  api(`/api/v1/posts/${postId}`, { method: "PATCH", headers: { "if-match": '"v2"' }, body: { title: `M4 OCC ${stamp} P2`, content: "## OCC\n\nParallel two du dai de cap nhat." } }),
]);
const statuses = parallel.map((entry) => entry.response.status).sort();
check("parallel same-version writes: one wins", JSON.stringify(statuses) === JSON.stringify([200, 412]), statuses.join(","));

const current = await api(`/api/v1/posts/${postId}`);
const currentVersion = current.json?.data?.version;
const stalePublish = await api(`/api/v1/posts/${postId}/publish`, { method: "POST", headers: { "if-match": '"v1"' } });
check("stale publish rejected", stalePublish.response.status === 412, `status=${stalePublish.response.status}`);

// Admin stale form
const jar = new Jar();
const loginPage = await request(jar, "/admin/login");
const login = await request(jar, "/admin/login", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: csrfFrom(loginPage.text), email: creds.admin.email, password: creds.admin.password }),
});
check("admin login for OCC", login.response.status === 302);
const editPage = await request(jar, `/admin/posts/${postId}/edit`);
const formVersion = /name="version" value="(\d+)"/.exec(editPage.text)?.[1];
const adminCsrf = csrfFrom(editPage.text);
check("admin editor has version", editPage.response.status === 200 && Number(formVersion) === currentVersion, `form=${formVersion} current=${currentVersion}`);
const apiWin = await api(`/api/v1/posts/${postId}`, {
  method: "PATCH",
  headers: { "if-match": `"v${currentVersion}"` },
  body: { title: `M4 OCC ${stamp} API wins`, content: "## OCC\n\nAPI wins du dai de cap nhat." },
});
check("API wins race", apiWin.response.status === 200);
const adminStale = await request(jar, `/admin/posts/${postId}`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    _csrf: adminCsrf,
    version: String(currentVersion),
    title: `M4 OCC ${stamp} Admin stale`,
    slug: prefix,
    excerpt: "",
    lede: "",
    content: "## OCC\n\nAdmin stale du dai de cap nhat.",
    content_format: "markdown",
    category_id: "",
    author_id: "user-m0-admin",
    tags: "",
    action: "save",
  }),
});
check("admin stale form shows conflict", adminStale.response.status === 200 && adminStale.text.includes("đã được thay đổi bởi phiên khác"));
const finalPost = await api(`/api/v1/posts/${postId}`);
check("stale admin did not overwrite", finalPost.json?.data?.title.includes("API wins"));

// Idempotent PATCH does not create duplicate revision
const before = d1(`SELECT COUNT(*) AS n FROM revisions WHERE post_id='${postId}';`, true)[0]?.results?.[0]?.n;
const idemKey = `${prefix}-patch-idem`;
const idemHeaders = { "idempotency-key": idemKey, "if-match": `"v${finalPost.json?.data?.version}"` };
const idemBody = { title: `M4 OCC ${stamp} idem`, content: "## OCC\n\nIdempotent update du dai." };
const idem1 = await api(`/api/v1/posts/${postId}`, { method: "PATCH", headers: idemHeaders, body: idemBody });
const afterFirst = d1(`SELECT COUNT(*) AS n FROM revisions WHERE post_id='${postId}';`, true)[0]?.results?.[0]?.n;
const idem2 = await api(`/api/v1/posts/${postId}`, { method: "PATCH", headers: idemHeaders, body: idemBody });
const afterReplay = d1(`SELECT COUNT(*) AS n FROM revisions WHERE post_id='${postId}';`, true)[0]?.results?.[0]?.n;
check("idempotent PATCH replay", idem1.response.status === 200 && idem2.response.status === 200 && idem2.response.headers.get("idempotent-replayed") === "true");
check("idempotent replay has no extra revision", Number(afterFirst) === Number(afterReplay) && Number(afterFirst) === Number(before) + 1, `${before} -> ${afterFirst} -> ${afterReplay}`);

d1(`
DELETE FROM posts_fts WHERE post_id='${postId}';
DELETE FROM post_tags WHERE post_id='${postId}';
DELETE FROM revisions WHERE post_id='${postId}';
DELETE FROM slug_history WHERE post_id='${postId}';
DELETE FROM posts WHERE id='${postId}';
DELETE FROM idempotency_keys WHERE client_id='client-m0-auto' AND idem_key LIKE '${prefix}%';
DELETE FROM sessions;
`);
const failed = results.filter((item) => !item.ok);
fs.writeFileSync(`fixtures/m4-occ-${stamp}.json`, JSON.stringify({ results, passed: results.length - failed.length, failed: failed.length }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
