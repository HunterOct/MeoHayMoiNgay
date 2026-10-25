import fs from "node:fs";

const BASE = (process.env.STAGING_BASE || "https://meohay-m0-stg-230403.poseidonxx001.workers.dev").replace(/\/+$/, "");
const STAGING_TOKEN = process.env.STAGING_TOKEN || fs.readFileSync(".staging-token", "utf8").trim();
const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const seedMeta = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const ADMIN_KEY = seedMeta.apiKey;
const stamp = Date.now().toString(36);

const html2kb = `<h2>CPU API test</h2><p>${"Nội dung bài kiểm chứng CPU cho Publishing API. ".repeat(40)}</p>`;
const markdown8kb = `# Tiêu đề kiểm chứng\n\n${"Đoạn văn **markdown** với [liên kết](https://example.com) và danh sách.\n\n- mục một\n- mục hai\n\n".repeat(80)}`;

const phaseNames = (process.argv[2] || "search-capped,category,api-create,sanitize-do,hash-do,login,api-create-do").split(",");

const phases = {
  "search-capped": {
    runs: 30,
    build: () => ({ method: "GET", path: "/api/m0/bench/search-capped?q=wifi&candidates=200" }),
  },
  category: {
    runs: 30,
    build: () => ({ method: "GET", path: "/api/m0/bench/category/wifi-mang" }),
  },
  "api-create": {
    runs: 12,
    build: (i) => ({
      method: "POST",
      path: "/api/m0/posts",
      key: ADMIN_KEY,
      body: {
        title: `CPU API create ${stamp} ${i}`,
        slug: `cpu-api-${stamp}-${i}`,
        excerpt: "CPU measurement",
        content: html2kb,
        content_format: "html",
        category: "wifi-mang",
        status: "draft",
      },
    }),
  },
  "sanitize-do": {
    runs: 10,
    build: () => ({
      method: "POST",
      path: "/api/m0/bench/sanitize",
      body: { html: markdown8kb, format: "markdown", mode: "do" },
    }),
  },
  "hash-do": {
    runs: 5,
    build: () => ({
      method: "POST",
      path: "/api/m0/bench/hash",
      body: { password: "M0-Test-Password-123", mode: "do", algorithm: "scrypt" },
    }),
  },
  login: {
    runs: 5,
    build: () => ({
      method: "POST",
      path: "/api/m0/auth/login",
      body: { email: "m0@test.local", password: seedMeta.password },
    }),
  },
  "api-create-do": {
    runs: 8,
    build: (i) => ({
      method: "POST",
      path: "/api/m0/posts?sanitizer=do",
      key: ADMIN_KEY,
      body: {
        title: `CPU API create DO ${stamp} ${i}`,
        slug: `cpu-api-do-${stamp}-${i}`,
        excerpt: "CPU measurement DO sanitize",
        content: markdown8kb,
        content_format: "markdown",
        category: "meo-vat",
        status: "draft",
      },
    }),
  },
};

function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function graphql(since, until) {
  const query = `query($account:String!,$script:String!,$since:Time!,$until:Time!){
    viewer { accounts(filter:{accountTag:$account}) {
      workersInvocationsAdaptive(limit:100, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
        dimensions { datetime }
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
      }
    } }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        account: env.CLOUDFLARE_ACCOUNT_ID,
        script: "meohay-m0-stg-230403",
        since: since.toISOString(),
        until: until.toISOString(),
      },
    }),
  });
  const payload = await response.json();
  return (payload?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || []).map((row) => ({
    datetime: row.dimensions.datetime,
    requests: row.sum.requests,
    errors: row.sum.errors,
    subrequests: row.sum.subrequests,
    cpuP50_ms: row.quantiles.cpuTimeP50 === null ? null : Number((row.quantiles.cpuTimeP50 / 1000).toFixed(3)),
    cpuP95_ms: row.quantiles.cpuTimeP95 === null ? null : Number((row.quantiles.cpuTimeP95 / 1000).toFixed(3)),
    cpuP99_ms: row.quantiles.cpuTimeP99 === null ? null : Number((row.quantiles.cpuTimeP99 / 1000).toFixed(3)),
  }));
}

const summary = [];
let previousEnd = 0;
for (const name of phaseNames) {
  const phase = phases[name];
  if (!phase) throw new Error(`Unknown phase ${name}`);
  const wait = previousEnd ? Math.max(0, 65_000 - (Date.now() - previousEnd)) : 0;
  if (wait > 0) {
    console.log(`waiting ${Math.ceil(wait / 1000)}s before ${name}`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const startedAt = new Date();
  const rows = [];
  const statuses = [];
  const errors = [];
  const extras = [];
  for (let i = 0; i < phase.runs; i += 1) {
    const request = phase.build(i);
    const headers = { "user-agent": "M0-Phase-Bench/1.0", "x-staging-token": STAGING_TOKEN };
    if (request.key) headers.authorization = `Bearer ${request.key}`;
    if (request.body !== undefined) headers["content-type"] = "application/json";
    const started = performance.now();
    try {
      const response = await fetch(BASE + request.path, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      statuses.push(response.status);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // ignore
      }
      extras.push(json?.meta || json?.verify_ms || null);
      rows.push(Number((performance.now() - started).toFixed(3)));
    } catch (error) {
      errors.push(String(error.message || error));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const until = new Date();
  const buckets = await graphql(new Date(startedAt.getTime() - 5_000), new Date(until.getTime() + 5_000));
  const entry = {
    phase: name,
    runs: phase.runs,
    ok: rows.length,
    errors,
    statuses: [...new Set(statuses)],
    wall_p50_ms: rows.length ? Number(pct(rows, 0.5).toFixed(1)) : null,
    wall_p95_ms: rows.length ? Number(pct(rows, 0.95).toFixed(1)) : null,
    started_at: startedAt.toISOString(),
    ended_at: until.toISOString(),
    buckets,
    sample_meta: extras.filter(Boolean).slice(0, 3),
  };
  summary.push(entry);
  console.log(JSON.stringify(entry));
  previousEnd = Date.now();
}

fs.writeFileSync(
  `fixtures/cpu-phases-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  JSON.stringify({ phases: summary, note: "Cloudflare GraphQL CPU is microseconds; converted to ms. Wall time is not CPU." }, null, 2),
);
