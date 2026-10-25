import fs from "node:fs";

const BASE = (process.env.STAGING_BASE || "").replace(/\/+$/, "");
const STAGING_TOKEN = process.env.STAGING_TOKEN || "";
const API_KEY = process.env.STAGING_API_KEY || "";
const SAMPLE_ARTICLE = process.env.STAGING_ARTICLE_SLUG || "wifi-nha-cham-7-cach-khac-phuc";

if (!BASE || !STAGING_TOKEN) {
  console.error("Set STAGING_BASE (https://...workers.dev) and STAGING_TOKEN locally. Do not paste tokens into chat.");
  process.exit(2);
}

const headers = {
  "x-staging-token": STAGING_TOKEN,
  "user-agent": "M0.5-remote-probe/1.0",
};
const results = [];
let cookie = "";

function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function hit(label, path, options = {}) {
  const { method = "GET", body, headers: extra = {}, key = API_KEY, runs = 1 } = options;
  const samples = [];
  let last = null;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const requestHeaders = { ...headers, ...extra };
    if (key && path.startsWith("/api/m0/")) requestHeaders.authorization = `Bearer ${key}`;
    if (cookie) requestHeaders.cookie = cookie;
    let payload;
    if (body !== undefined) {
      requestHeaders["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let response;
    let text;
    try {
      response = await fetch(BASE + path, {
        method,
        headers: requestHeaders,
        body: payload,
        redirect: "manual",
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      clearTimeout(timer);
      last = { label, path, method, status: 0, error: String(error.message || error), ms: null };
      results.push(last);
      console.log(JSON.stringify(last));
      break;
    } finally {
      clearTimeout(timer);
    }
    const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const setCookie of setCookies) cookie = setCookie.split(";")[0];
    const ms = performance.now() - started;
    samples.push(ms);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    last = {
      label,
      path,
      method,
      status: response.status,
      worker: response.headers.get("x-m0-worker"),
      cfCache: response.headers.get("cf-cache-status"),
      serverTiming: response.headers.get("server-timing"),
      bytes: Buffer.byteLength(text),
      ms: Number(ms.toFixed(3)),
      json,
    };
  }
  if (!last || last.status === 0) return last;
  const entry = {
    ...last,
    runs,
    p50_ms: Number(pct(samples, 0.5).toFixed(3)),
    p95_ms: Number(pct(samples, 0.95).toFixed(3)),
  };
  results.push(entry);
  console.log(JSON.stringify(entry));
  return entry;
}

await hit("health", "/api/m0/health", { key: null });
await hit("static-css", "/assets/css/style.css", { key: null });
await hit("static-article", `/bai-viet/${SAMPLE_ARTICLE}`, { key: null, runs: 3 });
await hit("dynamic-article", `/dyn/bai-viet/${SAMPLE_ARTICLE}`, { key: null, runs: 5 });
await hit("dynamic-home", "/dyn/home", { key: null, runs: 5 });
await hit("d1-meta", `/api/m0/bench/d1-meta/${SAMPLE_ARTICLE}`, { runs: 3 });
await hit("d1-write", "/api/m0/bench/d1-write", { method: "POST", body: {} });
await hit("search-capped", "/api/m0/bench/search-capped?q=wifi&candidates=200", { runs: 3 });
await hit("categories", "/api/m0/bench/categories", { runs: 3 });
await hit("sanitize-worker", "/api/m0/bench/sanitize", {
  method: "POST",
  body: { html: "<h2>Test</h2><p><strong>Bold</strong><script>alert(1)</script></p>", format: "html", mode: "worker" },
});
await hit("sanitize-do", "/api/m0/bench/sanitize", {
  method: "POST",
  body: { html: "<h2>Test</h2><p><strong>Bold</strong><script>alert(1)</script></p>", format: "html", mode: "do" },
});
await hit("hash-scrypt-do", "/api/m0/bench/hash", {
  method: "POST",
  body: { password: "M0-Staging-Test-Password", algorithm: "scrypt", mode: "do" },
});
await hit("login", "/api/m0/auth/login", {
  method: "POST",
  key: null,
  body: { email: "m0@test.local", password: "M0-Test-Password-123" },
});
const csrf = results.find((entry) => entry.label === "login")?.json?.csrf;
await hit("csrf-protected", "/api/m0/auth/protected", { key: null, headers: { "x-csrf-token": csrf || "" } });
await hit("rbac-admin", "/api/m0/rbac/admin", { key: null });
await hit("media-guard", "/media/probe.png", { key: null });
await hit("api-create", "/api/m0/posts", {
  method: "POST",
  body: {
    title: `M0 staging probe ${Date.now()}`,
    content: "Synthetic staging content for API verification. Do not use production data.",
    content_format: "markdown",
    status: "published",
  },
});
await hit("cron-manual", "/api/m0/cron/run", { method: "POST", body: {} });

const output = {
  generated_at: new Date().toISOString(),
  base: BASE,
  note: "Remote probe. CPU time must be collected separately from Workers metrics/tail; wall time is not CPU.",
  results,
};
fs.writeFileSync("fixtures/remote-results.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ written: "fixtures/remote-results.json", entries: results.length }));
