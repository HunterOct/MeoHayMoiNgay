import fs from "node:fs";

const BASE = (process.env.STAGING_BASE || "https://meohay-m0-stg-230403.poseidonxx001.workers.dev").replace(/\/+$/, "");
const STAGING_TOKEN = process.env.STAGING_TOKEN || fs.readFileSync(".staging-token", "utf8").trim();
const label = process.argv[2] || "article";
const path = process.argv[3] || "/dyn/bai-viet/wifi-nha-cham-7-cach-khac-phuc";
const runs = Number(process.argv[4] || 20);
const needToken = path.startsWith("/api/m0/");
const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const startedAt = new Date();
const samples = [];
const errors = [];
let cookie = "";

for (let i = 0; i < runs; i += 1) {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0",
  };
  if (needToken) headers["x-staging-token"] = STAGING_TOKEN;
  if (cookie) headers.cookie = cookie;
  const started = performance.now();
  try {
    const response = await fetch(BASE + path, {
      headers,
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
    });
    const text = await response.text();
    const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const setCookie of setCookies) cookie = setCookie.split(";")[0];
    samples.push({
      status: response.status,
      ms: Number((performance.now() - started).toFixed(3)),
      worker: response.headers.get("x-m0-worker"),
      cfCache: response.headers.get("cf-cache-status"),
      serverTiming: response.headers.get("server-timing"),
      bytes: Buffer.byteLength(text),
    });
  } catch (error) {
    errors.push({ ms: Number((performance.now() - started).toFixed(3)), error: String(error.message || error) });
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
const wallP50 = samples.length ? pct(samples.map((sample) => sample.ms), 0.5) : null;
const wallP95 = samples.length ? pct(samples.map((sample) => sample.ms), 0.95) : null;

const query = `query($account:String!,$script:String!,$since:Time!,$until:Time!){
  viewer { accounts(filter:{accountTag:$account}) {
    workersInvocationsAdaptive(limit:100, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
      dimensions { datetime }
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
    }
  } }
}`;
const until = new Date();
const since = new Date(startedAt.getTime() - 15_000);
let metrics = null;
try {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json",
    },
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
  metrics = await response.json();
} catch (error) {
  metrics = { error: String(error.message || error) };
}

const buckets = (metrics?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || []).map((row) => ({
  datetime: row.dimensions.datetime,
  requests: row.sum.requests,
  errors: row.sum.errors,
  cpuP50_us: row.quantiles.cpuTimeP50,
  cpuP95_us: row.quantiles.cpuTimeP95,
  cpuP99_us: row.quantiles.cpuTimeP99,
  cpuP50_ms: row.quantiles.cpuTimeP50 === null ? null : Number((row.quantiles.cpuTimeP50 / 1000).toFixed(3)),
  cpuP95_ms: row.quantiles.cpuTimeP95 === null ? null : Number((row.quantiles.cpuTimeP95 / 1000).toFixed(3)),
  cpuP99_ms: row.quantiles.cpuTimeP99 === null ? null : Number((row.quantiles.cpuTimeP99 / 1000).toFixed(3)),
}));
const output = {
  label,
  path,
  started_at: startedAt.toISOString(),
  runs,
  wall_p50_ms: wallP50,
  wall_p95_ms: wallP95,
  samples_ok: samples.length,
  samples_error: errors.length,
  statuses: [...new Set(samples.map((sample) => sample.status))],
  workerHeaders: [...new Set(samples.map((sample) => sample.worker))],
  cfCache: [...new Set(samples.map((sample) => sample.cfCache))],
  serverTiming: samples[0]?.serverTiming || null,
  errors,
  graphql_errors: metrics?.errors || null,
  buckets,
  note: "GraphQL cpuTime fields are microseconds; converted to ms by /1000. Wall time is not CPU.",
};
fs.writeFileSync(`fixtures/phase-${label}.json`, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
