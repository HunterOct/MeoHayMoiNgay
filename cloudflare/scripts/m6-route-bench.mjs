import fs from "node:fs";

const label = process.argv[2] || "run";
const perGroup = Number(process.argv[3] || 20);
const onlyGroups = new Set((process.argv[4] || "").split(",").filter(Boolean));
const warmupCount = Number(process.argv[5] || 3);
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
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
const stagingToken = fs.readFileSync(".staging-token", "utf8").trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function request(path, { method = "GET", headers = {}, body, jar = null } = {}) {
  const started = performance.now();
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        method,
        headers: {
          "user-agent": "Mozilla/5.0 M6-Route-Bench",
          ...(jar?.cookie ? { cookie: jar.cookie } : {}),
          ...headers,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (jar) jar.update(response);
      await response.arrayBuffer();
      return { status: response.status, ms: performance.now() - started };
    } catch (error) {
      lastError = error;
      await sleep(700);
    }
  }
  throw lastError;
}

async function adminLogin() {
  const jar = new Jar();
  const page = await fetch(BASE + "/admin/login", {
    headers: { "user-agent": "Mozilla/5.0 M6-Route-Bench" },
    signal: AbortSignal.timeout(30_000),
  }).catch(async (error) => {
    await sleep(2_000);
    return fetch(BASE + "/admin/login", {
      headers: { "user-agent": "Mozilla/5.0 M6-Route-Bench" },
      signal: AbortSignal.timeout(30_000),
    });
  });
  jar.update(page);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await page.text())?.[1];
  if (!csrf) throw new Error("login csrf missing");
  const login = await fetch(BASE + "/admin/login", {
    method: "POST",
    headers: {
      "user-agent": "Mozilla/5.0 M6-Route-Bench",
      cookie: jar.cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ _csrf: csrf, email: creds.admin.email, password: creds.admin.password }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  }).catch(async (error) => {
    await sleep(2_000);
    return fetch(BASE + "/admin/login", {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0 M6-Route-Bench",
        cookie: jar.cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: csrf, email: creds.admin.email, password: creds.admin.password }),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  });
  jar.update(login);
  if (login.status !== 302) throw new Error(`admin login failed: ${login.status}`);
  return jar;
}

async function api(path, { method = "GET", body } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        method,
        headers: {
          authorization: `Bearer ${seed.apiKey}`,
          "user-agent": "Mozilla/5.0 M6-Route-Bench",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // ignore
      }
      return { status: response.status, json, text, headers: response.headers };
    } catch (error) {
      lastError = error;
      await sleep(1_000 * (attempt + 1));
    }
  }
  throw lastError;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (n) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * n))] || 0;
  return {
    count: sorted.length,
    p50_ms: Number(pick(0.5).toFixed(2)),
    p95_ms: Number(pick(0.95).toFixed(2)),
    max_ms: Number((sorted[sorted.length - 1] || 0).toFixed(2)),
  };
}

const list = await api("/api/v1/posts?limit=5&status=published");
const posts = list.json?.data || [];
const articleSlug = posts[0]?.slug;
const postId = posts[0]?.id;
const categories = (await api("/api/v1/categories")).json?.data || [];
const categorySlug = categories[0]?.slug || "wifi-mang";
const tags = (await api("/api/v1/tags")).json?.data || [];
const tagSlug = tags[0]?.slug || "wifi-cham";
if (!articleSlug || !postId) throw new Error("no published post for benchmark");

const adminJar = await adminLogin();
const groups = [];

function buildGroups() {
  const routes = [
    { name: "home", path: "/", headers: {} },
    { name: "article", path: `/bai-viet/${encodeURIComponent(articleSlug)}`, headers: {} },
    { name: "search", path: "/tim-kiem?q=wifi", headers: {} },
    { name: "category", path: `/chuyen-muc/${encodeURIComponent(categorySlug)}`, headers: {} },
    { name: "tag", path: `/the/${encodeURIComponent(tagSlug)}`, headers: {} },
    { name: "admin_dashboard", path: "/admin", headers: {}, jar: adminJar },
    { name: "admin_editor", path: `/admin/posts/${postId}/edit`, headers: {}, jar: adminJar },
    {
      name: "api_list",
      path: "/api/v1/posts?limit=20",
      headers: { authorization: `Bearer ${seed.apiKey}` },
    },
    {
      name: "api_get",
      path: `/api/v1/posts/${postId}`,
      headers: { authorization: `Bearer ${seed.apiKey}` },
    },
  ];
  for (const route of routes) {
    groups.push({
      ...route,
      run: async () => request(route.path, { headers: route.headers, jar: route.jar }),
    });
  }
  groups.push({
    name: "api_create",
    run: async () =>
      api("/api/v1/posts", {
        method: "POST",
        body: {
          title: `M6 bench ${Date.now().toString(36)} ${Math.random().toString(36).slice(2, 7)}`,
          content: "## M6 bench\n\nNoi dung do hieu nang API create, du dai de qua validation.",
          status: "draft",
        },
      }),
  });
  groups.push({
    name: "cron",
    run: async () =>
      request("/api/m0/cron/run", {
        method: "POST",
        headers: { "x-staging-token": stagingToken, "content-type": "application/json" },
        body: "{}",
      }),
  });
}

async function waitForNextMinute() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(now.getUTCMinutes() + 1);
  await sleep(Math.max(500, next.getTime() - Date.now() + 800));
}

buildGroups();
if (onlyGroups.size) {
  for (let i = groups.length - 1; i >= 0; i -= 1) if (!onlyGroups.has(groups[i].name)) groups.splice(i, 1);
}
console.log(`M6 route bench "${label}" — ${groups.length} groups × ${perGroup} requests`);
for (const group of groups) {
  if (warmupCount > 0) {
    for (let i = 0; i < warmupCount; i += 1) {
      try {
        await group.run();
      } catch {
        // warm-up failure is measured separately
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  await waitForNextMinute();
  const start = new Date();
  const samples = [];
  const statuses = {};
  let groupError = null;
  for (let i = 0; i < perGroup; i += 1) {
    try {
      const result = await group.run();
      samples.push(result.ms ?? 0);
      statuses[result.status] = (statuses[result.status] || 0) + 1;
    } catch (error) {
      groupError = String(error?.cause?.code || error?.message || error);
      statuses.error = (statuses.error || 0) + 1;
      samples.push(0);
    }
  }
  const end = new Date();
  const record = {
    group: group.name,
    minute: `${start.toISOString().slice(0, 16)}:00Z`,
    start: start.toISOString(),
    end: end.toISOString(),
    statuses,
    wall: stats(samples),
    ...(groupError ? { error: groupError } : {}),
  };
  groups[groups.indexOf(group)].result = record;
  console.log(`${group.name.padEnd(16)} wall p50=${record.wall.p50_ms}ms p95=${record.wall.p95_ms}ms statuses=${JSON.stringify(statuses)}${groupError ? ` error=${groupError}` : ""}`);
  fs.writeFileSync(`fixtures/m6-route-bench-${label}-partial.json`, JSON.stringify({ label, generated_at: new Date().toISOString(), groups: groups.filter((item) => item.result).map((item) => item.result) }, null, 2));
}

const apiCreateIds = [];
const created = await api("/api/v1/posts?limit=50&status=draft");
for (const post of created.json?.data || []) {
  if (post.title?.startsWith("M6 bench ")) apiCreateIds.push(post.id);
}

const since = new Date(new Date(groups[0].result.start).getTime() - 60_000).toISOString();
const until = new Date(new Date(groups[groups.length - 1].result.end).getTime() + 60_000).toISOString();
await sleep(120_000);

const query = `query($account:String!,$script:String!,$since:Time!,$until:Time!){
  viewer { accounts(filter:{accountTag:$account}) {
    workersInvocationsAdaptive(limit:1000, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
      dimensions { datetimeMinute status }
      sum { requests errors cpuTimeUs subrequests }
      quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
    }
    durableObjectsInvocationsAdaptiveGroups(limit:1000, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
      dimensions { datetimeMinute objectId status }
      sum { requests errors }
      quantiles { cpuTimeP50 cpuTimeP95 }
    }
  } }
}`;
const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ query, variables: { account: env.CLOUDFLARE_ACCOUNT_ID, script: worker, since, until } }),
});
const payload = await response.json();
if (payload.errors?.length) throw new Error(JSON.stringify(payload.errors));
const account = payload.data.viewer.accounts[0];
const workerRows = account.workersInvocationsAdaptive || [];
const doRows = account.durableObjectsInvocationsAdaptiveGroups || [];

for (const group of groups) {
  const startMs = new Date(group.result.start).getTime();
  const endMs = new Date(group.result.end).getTime();
  const minuteKeys = new Set();
  for (let t = Math.floor(startMs / 60_000) * 60_000; t <= endMs; t += 60_000) {
    minuteKeys.add(`${new Date(t).toISOString().slice(0, 16)}:00Z`);
  }
  const rows = workerRows.filter((row) => minuteKeys.has(row.dimensions.datetimeMinute));
  const requests = rows.reduce((sum, row) => sum + (row.sum.requests || 0), 0);
  const cpuUs = rows.reduce((sum, row) => sum + (row.sum.cpuTimeUs || 0), 0);
  group.result.cpu = {
    requests,
    errors: rows.reduce((sum, row) => sum + (row.sum.errors || 0), 0),
    total_us: cpuUs,
    avg_ms: requests ? Number((cpuUs / requests / 1000).toFixed(2)) : null,
    p50_ms: rows.length ? Number(Math.max(...rows.map((row) => row.quantiles.cpuTimeP50 || 0)) / 1000).toFixed(2) : null,
    p95_ms: rows.length ? Number(Math.max(...rows.map((row) => row.quantiles.cpuTimeP95 || 0)) / 1000).toFixed(2) : null,
    p99_ms: rows.length ? Number(Math.max(...rows.map((row) => row.quantiles.cpuTimeP99 || 0)) / 1000).toFixed(2) : null,
    statuses: Object.fromEntries(rows.map((row) => [row.dimensions.status, row.sum.requests])),
  };
  const doForMinute = doRows.filter((row) => minuteKeys.has(row.dimensions.datetimeMinute));
  group.result.do = {
    requests: doForMinute.reduce((sum, row) => sum + (row.sum.requests || 0), 0),
    p95_ms: doForMinute.length ? Number(Math.max(...doForMinute.map((row) => row.quantiles.cpuTimeP95 || 0)) / 1000).toFixed(2) : null,
  };
}

const output = { label, generated_at: new Date().toISOString(), window: { since, until }, per_group: perGroup, groups };
fs.writeFileSync(`fixtures/m6-route-bench-${label}.json`, JSON.stringify(output, null, 2));
console.log("\nGroup            wall_p50  wall_p95  cpu_avg  cpu_p50  cpu_p95  cpu_p99  do_p95  req");
for (const group of groups) {
  const r = group.result;
  console.log(
    `${group.name.padEnd(16)} ${String(r.wall.p50_ms).padStart(8)} ${String(r.wall.p95_ms).padStart(9)} ${String(r.cpu?.avg_ms).padStart(8)} ${String(r.cpu?.p50_ms).padStart(8)} ${String(r.cpu?.p95_ms).padStart(8)} ${String(r.cpu?.p99_ms).padStart(8)} ${String(r.do?.p95_ms).padStart(7)} ${String(r.cpu?.requests).padStart(4)}`,
  );
}
if (apiCreateIds.length) {
  console.log(`\nCleanup API create posts: ${apiCreateIds.length} (delete via admin/D1 separately)`);
  fs.writeFileSync(`fixtures/m6-route-bench-created.json`, JSON.stringify(apiCreateIds));
}
