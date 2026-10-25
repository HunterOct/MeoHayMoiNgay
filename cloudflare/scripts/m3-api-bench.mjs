import fs from "node:fs";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const seed = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }),
);
const stamp = Date.now().toString(36);
const prefix = `m3bench-${stamp}`;

async function request(path, { method = "GET", body } = {}) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        method,
        headers: {
          "user-agent": "Mozilla/5.0 M3-Bench",
          authorization: `Bearer ${seed.apiKey}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      return { status: response.status, text: await response.text() };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw last;
}

const text = (bytes) => "Noi dung API benchmark. ".repeat(Math.ceil(bytes / 23)).slice(0, bytes);
const phases = [
  ["list", "/api/v1/posts?limit=20", "GET", 15, null],
  ["get", "/api/v1/posts/c9a4cddd-ac89-4c61-afd3-8dca8de37ef2", "GET", 15, null],
  ["create-2k", "/api/v1/posts", "POST", 8, (i) => ({ title: `M3 bench 2k ${i}`, slug: `${prefix}-2k-${i}`, content: text(2 * 1024), content_format: "markdown", status: "draft" })],
  ["create-8k", "/api/v1/posts", "POST", 8, (i) => ({ title: `M3 bench 8k ${i}`, slug: `${prefix}-8k-${i}`, content: text(8 * 1024), content_format: "markdown", status: "draft" })],
  ["create-30k", "/api/v1/posts", "POST", 4, (i) => ({ title: `M3 bench 30k ${i}`, slug: `${prefix}-30k-${i}`, content: text(30 * 1024), content_format: "markdown", status: "draft" })],
];
const output = [];
let previous = 0;
for (const [name, path, method, runs, build] of phases) {
  const wait = previous ? Math.max(0, 65_000 - (Date.now() - previous)) : 0;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const started = new Date();
  const times = [];
  const statuses = [];
  for (let i = 0; i < runs; i += 1) {
    const startedRequest = performance.now();
    const response = await request(path, { method, body: build ? build(i) : undefined });
    times.push(performance.now() - startedRequest);
    statuses.push(response.status);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const pct = (p) => {
    const sorted = [...times].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  output.push({ name, path, method, runs, started_at: started.toISOString(), ended_at: new Date().toISOString(), wall_p50_ms: Math.round(pct(0.5)), wall_p95_ms: Math.round(pct(0.95)), statuses: [...new Set(statuses)] });
  console.log(JSON.stringify(output.at(-1)));
  previous = Date.now();
}
fs.writeFileSync("fixtures/m3-api-bench-phases.json", JSON.stringify(output, null, 2));
console.log("waiting metrics");
await new Promise((resolve) => setTimeout(resolve, 150_000));
const query = `query($account:String!,$script:String!,$since:Time!,$until:Time!){viewer{accounts(filter:{accountTag:$account}){workersInvocationsAdaptive(limit:1000,filter:{scriptName:$script,datetime_geq:$since,datetime_leq:$until}){dimensions{datetime} sum{requests errors} quantiles{cpuTimeP50 cpuTimeP95 cpuTimeP99}}}}}`;
const graph = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ query, variables: { account: env.CLOUDFLARE_ACCOUNT_ID, script: "meohay-m0-stg-230403", since: output[0].started_at, until: new Date().toISOString() } }),
}).then((response) => response.json());
const rows = graph?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
const result = output.map((phase) => {
  const values = [];
  for (const row of rows) if (row.dimensions.datetime >= phase.started_at && row.dimensions.datetime <= phase.ended_at) {
    for (let i = 0; i < row.sum.requests; i += 1) values.push(row.quantiles.cpuTimeP50 / 1000);
  }
  const pct = (p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
  };
  return { ...phase, cpu_samples: values.length, cpu_p50_ms: +pct(0.5).toFixed(2), cpu_p95_ms: +pct(0.95).toFixed(2), cpu_max_ms: values.length ? +Math.max(...values).toFixed(2) : 0 };
});
fs.writeFileSync("fixtures/m3-api-bench.json", JSON.stringify({ phases: result, graphql_errors: graph.errors || null }, null, 2));
console.log(JSON.stringify(result, null, 2));
