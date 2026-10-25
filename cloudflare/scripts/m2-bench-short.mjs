import fs from "node:fs";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
const token = fs.readFileSync(".staging-token", "utf8").trim();
const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }),
);
function update(jar, response) {
  const map = new Map(jar.cookie.split("; ").filter(Boolean).map((item) => [item.split("=")[0], item]));
  for (const raw of response.headers.getSetCookie?.() || []) {
    const pair = raw.split(";")[0];
    const key = pair.split("=")[0];
    if (pair.endsWith("=")) map.delete(key);
    else map.set(key, pair);
  }
  jar.cookie = [...map.values()].join("; ");
}
async function request(jar, path, options = {}) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        ...options,
        headers: { "user-agent": "Mozilla/5.0 M2-Bench", ...(jar ? { cookie: jar.cookie } : {}), ...(options.headers || {}) },
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      });
      if (jar) update(jar, response);
      return { response, text: await response.text() };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw last;
}

await fetch(`${BASE}/api/m0/bench/reset-rate`, {
  method: "POST",
  headers: { "x-staging-token": token, "content-type": "application/json" },
  body: "{}",
});
const jar = { cookie: "" };
const loginPage = await request(jar, "/admin/login");
const loginCsrf = /name="_csrf" value="([^"]+)"/.exec(loginPage.text)?.[1];
const login = await request(jar, "/admin/login", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: loginCsrf, email: creds.admin.email, password: creds.admin.password }),
});
if (login.response.status !== 302) throw new Error("login failed");
const postId = "c9a4cddd-ac89-4c61-afd3-8dca8de37ef2";
const phases = [
  ["dashboard", "/admin", 15],
  ["posts", "/admin/posts", 15],
  ["editor", `/admin/posts/${postId}/edit`, 15],
  ["preview", `/admin/posts/${postId}/preview`, 15],
  ["categories", "/admin/categories", 15],
  ["users", "/admin/users", 15],
];
const output = [];
let previous = 0;
for (const [name, path, runs] of phases) {
  const wait = previous ? Math.max(0, 65_000 - (Date.now() - previous)) : 0;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const start = new Date();
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    const hit = await request(jar, path);
    times.push(performance.now() - t);
    if (hit.response.status !== 200) throw new Error(`${name} ${hit.response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const pct = (p) => {
    const sorted = [...times].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  output.push({ name, path, runs, started_at: start.toISOString(), ended_at: new Date().toISOString(), wall_p50_ms: Math.round(pct(0.5)), wall_p95_ms: Math.round(pct(0.95)) });
  console.log(JSON.stringify(output.at(-1)));
  previous = Date.now();
}
fs.writeFileSync("fixtures/m2-bench-short-phases.json", JSON.stringify(output, null, 2));
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
fs.writeFileSync("fixtures/m2-bench-short.json", JSON.stringify({ phases: result, graphql_errors: graph.errors || null }, null, 2));
console.log(JSON.stringify(result, null, 2));
