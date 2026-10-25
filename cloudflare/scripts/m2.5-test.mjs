import fs from "node:fs";
import { spawnSync } from "node:child_process";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const token = fs.readFileSync(".staging-token", "utf8").trim();
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
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

async function request(jar, path, options = {}) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        ...options,
        headers: {
          "user-agent": "Mozilla/5.0 M2.5-Test",
          ...(jar ? { cookie: jar.cookie } : {}),
          ...(options.headers || {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      if (jar) jar.update(response);
      return { response, text: await response.text() };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw last;
}

const csrfFrom = (text) => /name="_csrf" value="([^"]+)"/.exec(text)?.[1] || "";

async function login(role, jar = new Jar()) {
  const page = await request(jar, "/admin/login");
  const csrf = csrfFrom(page.text);
  const response = await request(jar, "/admin/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, email: creds[role].email, password: creds[role].password }),
  });
  return { jar, ...response };
}

async function form(jar, path, fields, tokenPath = "/admin") {
  const page = await request(jar, tokenPath);
  const csrf = csrfFrom(page.text);
  return request(jar, path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, ...fields }),
  });
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
  const file = `fixtures/.${stamp}.sql`;
  fs.writeFileSync(file, sql);
  const result = spawnSync("npx.cmd", ["wrangler", "d1", "execute", "meohay-m0-stg-230403", "--remote", "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--file", file], { encoding: "utf8", shell: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

async function resetRate() {
  await fetch(`${BASE}/api/m0/bench/reset-rate`, { method: "POST", headers: { "x-staging-token": token, "content-type": "application/json" }, body: "{}" });
}

await resetRate();
const admin = await login("admin");
check("admin login", admin.response.status === 302);
const adminJar = admin.jar;

/* API client lifecycle */
const clientName = `M25 client ${stamp}`;
const clientPage = await request(adminJar, "/admin/api-clients");
const create = await request(adminJar, "/admin/api-clients", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    _csrf: csrfFrom(clientPage.text),
    name: clientName,
    scopes: "posts:read",
    publish_mode: "review",
    rate_limit_per_min: "60",
  }),
});
const key1 = /<code id="newApiKey">([^<]+)<\/code>/.exec(create.text)?.[1] || "";
const clientRow = d1(`SELECT id,key_hash,scopes,publish_mode,rate_limit_per_min FROM api_clients WHERE name='${clientName}';`, true)[0]?.results?.[0];
check("API client created", create.response.status === 200 && key1.startsWith("mh_") && Boolean(clientRow));
check("API key hash only", Boolean(clientRow?.key_hash) && clientRow.key_hash !== key1);
const apiGet = await request(null, "/api/m0/posts/c9a4cddd-ac89-4c61-afd3-8dca8de37ef2", {
  headers: { authorization: `Bearer ${key1}`, "x-staging-token": token },
});
check("new API key works", apiGet.response.status === 200);
const rotate = await form(adminJar, `/admin/api-clients/${clientRow.id}/rotate`, {}, "/admin/api-clients");
const key2 = /<code id="newApiKey">([^<]+)<\/code>/.exec(rotate.text)?.[1] || "";
check("rotate returns new key", rotate.response.status === 200 && key2.startsWith("mh_") && key2 !== key1);
const oldKey = await request(null, "/api/m0/posts/c9a4cddd-ac89-4c61-afd3-8dca8de37ef2", {
  headers: { authorization: `Bearer ${key1}`, "x-staging-token": token },
});
const newKey = await request(null, "/api/m0/posts/c9a4cddd-ac89-4c61-afd3-8dca8de37ef2", {
  headers: { authorization: `Bearer ${key2}`, "x-staging-token": token },
});
check("old key revoked after rotate", oldKey.response.status === 401 && newKey.response.status === 200);
const update = await form(adminJar, `/admin/api-clients/${clientRow.id}`, {
  name: clientName,
  scopes: "posts:read",
  publish_mode: "auto",
  rate_limit_per_min: "120",
}, "/admin/api-clients");
const updated = d1(`SELECT publish_mode,rate_limit_per_min,scopes FROM api_clients WHERE id='${clientRow.id}';`, true)[0]?.results?.[0];
check("API client settings update", update.response.status === 302 && updated?.publish_mode === "auto" && Number(updated?.rate_limit_per_min) === 120);
const revoke = await form(adminJar, `/admin/api-clients/${clientRow.id}/revoke`, {}, "/admin/api-clients");
const revokedKey = await request(null, "/api/m0/posts/c9a4cddd-ac89-4c61-afd3-8dca8de37ef2", {
  headers: { authorization: `Bearer ${key2}`, "x-staging-token": token },
});
check("revoked key denied immediately", revoke.response.status === 302 && revokedKey.response.status === 401);
const audit = await request(adminJar, "/admin/audit");
check("API client audit entries", audit.text.includes("apikey.created") && audit.text.includes("apikey.rotated") && audit.text.includes("apikey.revoked"));
const editor = await login("editor");
const editorClients = await request(editor.jar, "/admin/api-clients");
check("editor cannot manage API clients", editorClients.response.status === 403);
d1(`DELETE FROM api_clients WHERE id='${clientRow.id}';`);

/* allow_ai_crawlers */
const settingsFields = {
  site_name: "Mẹo Hay Mỗi Ngày",
  site_tagline: "Mẹo vặt đời sống & công nghệ — dễ làm, không tốn tiền",
  site_description: "Mẹo Hay Mỗi Ngày — blog mẹo vặt đời sống: nhà cửa gọn thơm, ăn uống và bảo quản thực phẩm, ngủ ngon khỏe người, cùng mẹo công nghệ như wifi nhanh hơn, điện thoại mượt hơn. Mỗi bài một vấn đề, làm theo từng bước trong vài phút.",
  copyright: "Nội dung và hình ảnh thuộc Mẹo Hay Mỗi Ngày, vui lòng không sao chép khi chưa được đồng ý.",
};
const settingWith = (allow) => form(adminJar, "/admin/settings", { ...settingsFields, allow_ai_crawlers: allow ? "1" : "0" }, "/admin/settings");
await settingWith(true);
await new Promise((resolve) => setTimeout(resolve, 6000));
const aiAllowed = await request(null, "/", { headers: { "user-agent": "GPTBot/1.0" } });
const robotsAllowed = await request(null, "/robots.txt");
check("allow_ai_crawlers opens GPTBot", aiAllowed.response.status === 200 && !robotsAllowed.text.includes("User-agent: GPTBot\nDisallow: /"));
await settingWith(false);
await new Promise((resolve) => setTimeout(resolve, 6000));
const aiBlocked = await request(null, "/", { headers: { "user-agent": "GPTBot/1.0" } });
const google = await request(null, "/", { headers: { "user-agent": "Googlebot/2.1" } });
const robotsBlocked = await request(null, "/robots.txt");
check("AI crawler blocked when disabled", aiBlocked.response.status === 403);
check("Googlebot remains allowed", google.response.status === 200);
check("robots reflects AI setting", robotsBlocked.text.includes("User-agent: GPTBot") && robotsBlocked.text.includes("Disallow: /"));

/* retention cleanup */
const fakeHash = "a".repeat(64);
d1(`
INSERT OR REPLACE INTO sessions (id,user_id,csrf_token,ip,user_agent,created_at,last_seen_at,expires_at) VALUES ('${fakeHash}','user-m0-admin','x','1.2.3.4','test','2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z');
INSERT INTO login_attempts (email,ip,success,created_at) VALUES ('m25-old@test.local','1.2.3.4',0,'2000-01-01T00:00:00.000Z');
INSERT INTO idempotency_keys (client_id,idem_key,method,path,request_hash,status_code,response_body,created_at) VALUES ('client-m0-auto','m25-old','POST','/x','h',200,'{}','2000-01-01T00:00:00.000Z');
`);
const cleanup = await request(null, "/api/m0/bench/cleanup", { method: "POST", headers: { "x-staging-token": token } });
const fakeSession = d1(`SELECT id FROM sessions WHERE id='${fakeHash}';`, true)[0]?.results || [];
const fakeAttempts = d1(`SELECT id FROM login_attempts WHERE email='m25-old@test.local';`, true)[0]?.results || [];
const fakeIdem = d1(`SELECT idem_key FROM idempotency_keys WHERE idem_key='m25-old';`, true)[0]?.results || [];
const currentAdmin = await request(adminJar, "/admin");
check("cleanup removes expired operational rows", cleanup.response.status === 200 && fakeSession.length === 0 && fakeAttempts.length === 0 && fakeIdem.length === 0);
check("cleanup preserves current session", currentAdmin.response.status === 200);

d1(`DELETE FROM sessions WHERE user_id='user-m0-admin'; DELETE FROM login_attempts WHERE email LIKE 'm25-%';`);
const failed = results.filter((item) => !item.ok);
fs.writeFileSync(`fixtures/m2.5-test-${stamp}.json`, JSON.stringify({ results, passed: results.length - failed.length, failed: failed.length }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
