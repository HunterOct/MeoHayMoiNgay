import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
const stagingToken = fs.readFileSync(".staging-token", "utf8").trim();
const stamp = Date.now().toString(36);
const P = `m2sec-${stamp}`;
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
class Jar {
  cookie = "";
  update(response) {
    const values = response.headers.getSetCookie?.() || [];
    const map = new Map(this.cookie.split("; ").filter(Boolean).map((item) => [item.split("=")[0], item]));
    for (const raw of values) {
      const pair = raw.split(";")[0];
      const key = pair.split("=")[0];
      if (pair.endsWith("=")) map.delete(key);
      else map.set(key, pair);
    }
    this.cookie = [...map.values()].join("; ");
    return values;
  }
}
async function request(jar, path, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        ...options,
        headers: { "user-agent": "Mozilla/5.0 M2-Security", ...(jar ? { cookie: jar.cookie } : {}), ...(options.headers || {}) },
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
const csrfFrom = (text) => /name="_csrf" value="([^"]+)"/.exec(text)?.[1] || "";
async function login(email, password, jar = new Jar()) {
  const page = await request(jar, "/admin/login");
  const csrf = csrfFrom(page.text);
  const response = await request(jar, "/admin/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, email, password }),
  });
  return { jar, ...response };
}
async function adminPage(jar, path) {
  return request(jar, path);
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
    const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "meohay-m0-stg-230403", "--remote", "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--command", sql, "--json"], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
  }
  const file = `fixtures/.${P}.sql`;
  fs.writeFileSync(file, sql);
  const result = spawnSync("npx.cmd", ["wrangler", "d1", "execute", "meohay-m0-stg-230403", "--remote", "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--file", file], { encoding: "utf8", shell: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
async function resetRate() {
  await fetch(`${BASE}/api/m0/bench/reset-rate`, {
    method: "POST",
    headers: { "x-staging-token": stagingToken, "content-type": "application/json" },
    body: "{}",
  });
}

await resetRate();
const admin = await login(creds.admin.email, creds.admin.password);
check("admin login for security tests", admin.response.status === 302);

// create a throwaway user
const email = `${P}@test.local`;
const password = `M2Sec-${stamp}-Pass1`;
const create = await form(admin.jar, "/admin/users", { name: "M2 Security User", email, role: "author", password }, "/admin/users");
check("security test user created", create.response.status === 302);
const userId = d1(`SELECT id FROM users WHERE email='${email}';`, true)[0]?.results?.[0]?.id || "";
check("security test user id", Boolean(userId), userId);

// session cookie flags + fixation
const user = await login(email, password);
const setCookies = user.response.headers.getSetCookie?.() || [];
const sessionRaw = setCookies.find((item) => item.startsWith("mh_session="));
check("user login", user.response.status === 302);
check("user session cookie flags", /HttpOnly/i.test(sessionRaw || "") && /Secure/i.test(sessionRaw || "") && /SameSite=Lax/i.test(sessionRaw || ""));
const firstSessionToken = decodeURIComponent((user.jar.cookie.match(/mh_session=([^;]+)/) || [])[1] || "");
const oldToken = firstSessionToken;
const fixationJar = new Jar();
const loginPage = await request(fixationJar, "/admin/login");
const loginCsrf = csrfFrom(loginPage.text);
const loginCookie = (fixationJar.cookie.match(/mh_login_csrf=([^;]+)/) || [])[1] || "";
const second = await request(null, "/admin/login", {
  method: "POST",
  headers: {
    cookie: `mh_login_csrf=${loginCookie}; mh_session=${oldToken}`,
    "content-type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ _csrf: loginCsrf, email, password }),
});
check("login with existing cookie succeeds", second.response.status === 302);
const oldHash = crypto.createHash("sha256").update(oldToken).digest("hex");
const oldSessionRow = d1(`SELECT id FROM sessions WHERE id='${oldHash}';`, true)[0]?.results || [];
check("old session revoked on new login", oldSessionRow.length === 0);

// session expiry
const expiryLogin = await login(email, password);
const token = decodeURIComponent((expiryLogin.jar.cookie.match(/mh_session=([^;]+)/) || [])[1] || "");
const hash = crypto.createHash("sha256").update(token).digest("hex");
d1(`UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id='${hash}';`);
const expired = await request(expiryLogin.jar, "/admin");
check("expired session rejected", expired.response.status === 302 && expired.response.headers.get("location")?.startsWith("/admin/login"));

// session revoked when user disabled
const live = await login(email, password);
const liveToken = decodeURIComponent((live.jar.cookie.match(/mh_session=([^;]+)/) || [])[1] || "");
const liveHash = crypto.createHash("sha256").update(liveToken).digest("hex");
const disable = await form(admin.jar, `/admin/users/${userId}`, { name: "M2 Security User", email, role: "author", is_active: "" }, "/admin/users");
check("disable test user", disable.response.status === 302);
const afterDisable = await request(live.jar, "/admin");
check("disabled user session revoked", afterDisable.response.status === 302 && afterDisable.response.headers.get("location")?.startsWith("/admin/login"));
const sessionsLeft = d1(`SELECT id FROM sessions WHERE id='${liveHash}';`, true)[0]?.results || [];
check("disabled user session row deleted", sessionsLeft.length === 0);

// re-enable, then lock via failed attempts
const enable = await form(admin.jar, `/admin/users/${userId}`, { name: "M2 Security User", email, role: "author", is_active: "1" }, "/admin/users");
check("re-enable test user", enable.response.status === 302);
await resetRate();
for (let i = 0; i < 8; i += 1) {
  await login(email, "Wrong-Password-123");
}
const lockRow = d1(`SELECT failed_attempts, locked_until FROM users WHERE id='${userId}';`, true)[0]?.results?.[0];
check("failed attempts reach lock threshold", Number(lockRow?.failed_attempts || 0) >= 8 && Boolean(lockRow?.locked_until));
const lockedLogin = await login(email, password);
check("locked account rejected", lockedLogin.response.status === 200 && lockedLogin.text.includes("Tài khoản tạm khóa"));
await resetRate();

// rate limiting: 16 bad logins for a non-existing account
let lastStatus = 0;
for (let i = 0; i < 16; i += 1) {
  const attempt = await login(`${P}-nobody@test.local`, "Wrong-Password-123");
  lastStatus = attempt.response.status;
}
check("login rate limit returns 429", lastStatus === 429, String(lastStatus));
await resetRate();

// do not leak hashes/keys in admin HTML
const usersPage = await adminPage(admin.jar, "/admin/users");
const clientsPage = await adminPage(admin.jar, "/admin/api-clients");
check("user page hides password hashes", !usersPage.text.includes("scrypt$"));
check("client page hides key secrets", !clientsPage.text.includes("mh_") || !clientsPage.text.includes("secret"));

// cleanup
d1(`
DELETE FROM sessions WHERE user_id='${userId}';
DELETE FROM login_attempts WHERE email='${email}' OR email LIKE '${P}%';
DELETE FROM users WHERE id='${userId}';
`);
const failed = results.filter((item) => !item.ok);
fs.writeFileSync(`fixtures/m2-security-${stamp}.json`, JSON.stringify({ stamp, results, passed: results.length - failed.length, failed: failed.length }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
