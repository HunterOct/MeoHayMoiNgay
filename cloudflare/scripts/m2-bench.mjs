import fs from "node:fs";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
const token = fs.readFileSync(".staging-token", "utf8").trim();
const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

function jarUpdate(jar, response) {
  const values = response.headers.getSetCookie?.() || [];
  const map = new Map(jar.cookie.split("; ").filter(Boolean).map((item) => [item.split("=")[0], item]));
  for (const raw of values) {
    const pair = raw.split(";")[0];
    const key = pair.split("=")[0];
    if (pair.endsWith("=")) map.delete(key);
    else map.set(key, pair);
  }
  jar.cookie = [...map.values()].join("; ");
}

async function request(jar, path, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        ...options,
        headers: { "user-agent": "Mozilla/5.0 M2-Bench", ...(jar ? { cookie: jar.cookie } : {}), ...(options.headers || {}) },
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      });
      if (jar) jarUpdate(jar, response);
      return { response, text: await response.text() };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError;
}

await fetch(`${BASE}/api/m0/bench/reset-rate`, {
  method: "POST",
  headers: { "x-staging-token": token, "content-type": "application/json" },
  body: "{}",
});
const jar = { cookie: "" };
const loginPage = await request(jar, "/admin/login");
const csrf = /name="_csrf" value="([^"]+)"/.exec(loginPage.text)?.[1];
const login = await request(jar, "/admin/login", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: csrf, email: creds.admin.email, password: creds.admin.password }),
});
if (login.response.status !== 302) throw new Error(`login failed: ${login.response.status}`);

const postId = "c9a4cddd-ac89-4c61-afd3-8dca8de37ef2";
const phases = [
  ["dashboard", "/admin", 12],
  ["posts", "/admin/posts", 12],
  ["editor", `/admin/posts/${postId}/edit`, 12],
  ["preview", `/admin/posts/${postId}/preview`, 12],
  ["categories", "/admin/categories", 12],
  ["users", "/admin/users", 12],
  ["settings", "/admin/settings", 12],
  ["media", "/admin/media", 12],
];

const output = [];
let previousEnd = 0;
for (const [name, path, runs] of phases) {
  const wait = previousEnd ? Math.max(0, 65_000 - (Date.now() - previousEnd)) : 0;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const startedAt = new Date();
  const times = [];
  const statuses = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const hit = await request(jar, path);
    times.push(performance.now() - started);
    statuses.push(hit.response.status);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const pct = (p) => {
    const sorted = [...times].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  output.push({
    name,
    path,
    runs,
    started_at: startedAt.toISOString(),
    ended_at: new Date().toISOString(),
    wall_p50_ms: Number(pct(0.5).toFixed(1)),
    wall_p95_ms: Number(pct(0.95).toFixed(1)),
    statuses: [...new Set(statuses)],
  });
  console.log(name, output.at(-1).wall_p50_ms, output.at(-1).wall_p95_ms, [...new Set(statuses)]);
  previousEnd = Date.now();
}

fs.writeFileSync("fixtures/m2-bench-phases.json", JSON.stringify(output, null, 2));
console.log("waiting for GraphQL metrics...");
await new Promise((resolve) => setTimeout(resolve, 180_000));
const since = new Date(new Date(output[0].started_at).getTime() - 10_000).toISOString();
const until = new Date().toISOString();
const query = `query($account:String!,$script:String!,$since:Time!,$until:Time!){
  viewer { accounts(filter:{accountTag:$account}) {
    workersInvocationsAdaptive(limit:1000, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
      dimensions { datetime }
      sum { requests errors }
      quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
    }
  } }
}`;
const graph = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ query, variables: { account: env.CLOUDFLARE_ACCOUNT_ID, script: "meohay-m0-stg-230403", since, until } }),
}).then((response) => response.json());
const rows = graph?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
const result = output.map((phase) => {
  const values = [];
  for (const row of rows) {
    if (row.dimensions.datetime >= phase.started_at && row.dimensions.datetime <= phase.ended_at) {
      for (let i = 0; i < row.sum.requests; i += 1) values.push(row.quantiles.cpuTimeP50 / 1000);
    }
  }
  const pct = (p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
  };
  return {
    ...phase,
    cpu_samples: values.length,
    cpu_p50_ms: Number(pct(0.5).toFixed(2)),
    cpu_p95_ms: Number(pct(0.95).toFixed(2)),
    cpu_max_ms: values.length ? Number(Math.max(...values).toFixed(2)) : 0,
    errors: rows
      .filter((row) => row.dimensions.datetime >= phase.started_at && row.dimensions.datetime <= phase.ended_at)
      .reduce((sum, row) => sum + row.sum.errors, 0),
  };
});
fs.writeFileSync("fixtures/m2-bench.json", JSON.stringify({ phases: result, graphql_errors: graph.errors || null }, null, 2));
console.log(JSON.stringify(result, null, 2));
