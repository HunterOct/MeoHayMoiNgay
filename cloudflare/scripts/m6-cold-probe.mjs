import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const config = JSON.parse(fs.readFileSync("wrangler.remote.jsonc", "utf8"));
const BASE = config.vars.SITE_URL;
const worker = config.name;
const seed = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const token = fs.readFileSync(".staging-token", "utf8").trim();
const UA = "Mozilla/5.0 M6-Cold-Probe";

const list = await fetch(`${BASE}/api/v1/posts?limit=1&status=published`, {
  headers: { authorization: `Bearer ${seed.apiKey}`, "user-agent": UA },
});
const post = (await list.json()).data?.[0];
if (!post) throw new Error("no post");

const routes = [
  { name: "home", path: "/", headers: {} },
  { name: "article", path: `/bai-viet/${encodeURIComponent(post.slug)}`, headers: {} },
  { name: "search", path: "/tim-kiem?q=wifi", headers: {} },
  { name: "admin_login", path: "/admin/login", headers: {} },
  { name: "api_list", path: "/api/v1/posts?limit=10", headers: { authorization: `Bearer ${seed.apiKey}` } },
  { name: "api_get", path: `/api/v1/posts/${post.id}`, headers: { authorization: `Bearer ${seed.apiKey}` } },
  { name: "cron", path: "/api/m0/cron/run", method: "POST", headers: { "x-staging-token": token, "content-type": "application/json" }, body: "{}" },
];

const started = new Date();
const samples = [];
for (const route of routes) {
  const begin = performance.now();
  let status = 0;
  try {
    const response = await fetch(BASE + route.path, {
      method: route.method || "GET",
      headers: { "user-agent": UA, ...route.headers },
      body: route.body,
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    await response.arrayBuffer();
  } catch {
    status = 0;
  }
  samples.push({ route: route.name, status, wall_ms: Number((performance.now() - begin).toFixed(2)) });
  console.log(`${route.name.padEnd(12)} ${status} ${samples[samples.length - 1].wall_ms}ms`);
}
const ended = new Date();
await new Promise((resolve) => setTimeout(resolve, 120_000));

const minuteKeys = new Set();
for (let t = Math.floor(started.getTime() / 60_000) * 60_000; t <= ended.getTime(); t += 60_000) {
  minuteKeys.add(`${new Date(t).toISOString().slice(0, 16)}:00Z`);
}
const query = `query($account:String!,$script:String!,$since:Time!,$until:Time!){
  viewer { accounts(filter:{accountTag:$account}) {
    workersInvocationsAdaptive(limit:100, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
      dimensions { datetimeMinute status }
      sum { requests errors cpuTimeUs }
      quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
    }
    durableObjectsInvocationsAdaptiveGroups(limit:100, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
      dimensions { datetimeMinute objectId }
      sum { requests errors }
      quantiles { cpuTimeP50 cpuTimeP95 }
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
      script: worker,
      since: new Date(started.getTime() - 60_000).toISOString(),
      until: new Date(ended.getTime() + 60_000).toISOString(),
    },
  }),
});
const payload = await response.json();
if (payload.errors?.length) throw new Error(JSON.stringify(payload.errors));
const account = payload.data.viewer.accounts[0];
const rows = (account.workersInvocationsAdaptive || []).filter((row) => minuteKeys.has(row.dimensions.datetimeMinute));
const doRows = account.durableObjectsInvocationsAdaptiveGroups || [];
const requests = rows.reduce((sum, row) => sum + (row.sum.requests || 0), 0);
const cpuUs = rows.reduce((sum, row) => sum + (row.sum.cpuTimeUs || 0), 0);
const output = {
  generated_at: new Date().toISOString(),
  minute_keys: [...minuteKeys],
  samples,
  workers: {
    requests,
    errors: rows.reduce((sum, row) => sum + (row.sum.errors || 0), 0),
    cpu_total_us: cpuUs,
    avg_ms: requests ? Number((cpuUs / requests / 1000).toFixed(2)) : null,
    p50_ms: rows.length ? Number(Math.max(...rows.map((row) => row.quantiles.cpuTimeP50 || 0)) / 1000).toFixed(2) : null,
    p95_ms: rows.length ? Number(Math.max(...rows.map((row) => row.quantiles.cpuTimeP95 || 0)) / 1000).toFixed(2) : null,
    p99_ms: rows.length ? Number(Math.max(...rows.map((row) => row.quantiles.cpuTimeP99 || 0)) / 1000).toFixed(2) : null,
  },
  do: {
    requests: doRows.reduce((sum, row) => sum + (row.sum.requests || 0), 0),
    p95_ms: doRows.length ? Number(Math.max(...doRows.map((row) => row.quantiles.cpuTimeP95 || 0)) / 1000).toFixed(2) : null,
  },
};
fs.writeFileSync("fixtures/m6-cold-probe.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output.workers, null, 2));
