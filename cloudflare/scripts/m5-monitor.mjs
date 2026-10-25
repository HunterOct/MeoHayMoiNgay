import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

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
const worker = getArg("--worker", config.name);
const dbId = getArg("--db", config.d1_databases[0].database_id);
const site = getArg("--site", config.vars.SITE_URL);
const hours = Number(getArg("--hours", "24"));
const now = new Date();
const since = new Date(now.getTime() - hours * 3_600_000);
const until = now;
const account = env.CLOUDFLARE_ACCOUNT_ID;
const token = env.CLOUDFLARE_API_TOKEN;

const FREE = {
  workersRequestsPerDay: 100_000,
  workersCpuMsPerRequest: 10,
  d1RowsReadPerDay: 5_000_000,
  d1RowsWrittenPerDay: 100_000,
  d1StoragePerDatabaseBytes: 500 * 1024 * 1024,
  d1StoragePerAccountBytes: 5 * 1024 * 1024 * 1024,
  durableObjectRequestsPerDay: 100_000,
};

const THRESHOLDS = [
  { name: "monitor", at: 0.5, level: "INFO" },
  { name: "warning", at: 0.7, level: "WARN" },
  { name: "high", at: 0.85, level: "HIGH" },
  { name: "critical", at: 0.95, level: "CRIT" },
];

async function gql(query, variables) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json();
      if (payload.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(payload.errors)}`);
      return payload.data.viewer.accounts[0];
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function d1Query(sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(`D1 query failed: ${JSON.stringify(payload.errors || payload)}`);
  }
  return payload.result?.[0]?.results || [];
}

function statusFor(ratio) {
  if (!Number.isFinite(ratio)) return "-";
  if (ratio >= THRESHOLDS[3].at) return "CRIT";
  if (ratio >= THRESHOLDS[2].at) return "HIGH";
  if (ratio >= THRESHOLDS[1].at) return "WARN";
  if (ratio >= THRESHOLDS[0].at) return "INFO";
  return "OK";
}

const findings = [];
function record(metric, used, quota, unit, note = "", enforce = true) {
  const ratio = quota ? used / quota : null;
  const status = enforce ? statusFor(ratio) : "INFO";
  const item = { metric, used, quota, unit, ratio: ratio === null ? null : Number(ratio.toFixed(4)), status, note };
  if (["WARN", "HIGH", "CRIT"].includes(status)) findings.push(item);
  return item;
}

const accountData = await gql(
  `query($account:String!,$script:String!,$db:String!,$since:Time!,$until:Time!){
    viewer { accounts(filter:{accountTag:$account}) {
      workersTotals: workersInvocationsAdaptive(limit:100, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
        sum { requests errors subrequests cpuTimeUs }
        quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
      }
      workersByStatus: workersInvocationsAdaptive(limit:100, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
        dimensions { status }
        sum { requests errors }
      }
      d1Totals: d1AnalyticsAdaptiveGroups(limit:100, filter:{databaseId:$db, datetime_geq:$since, datetime_leq:$until}) {
        dimensions { databaseId }
        sum { rowsRead rowsWritten readQueries writeQueries queryBatchResponseBytes }
        quantiles { queryBatchTimeMsP50 queryBatchTimeMsP95 }
      }
      d1StorageAll: d1StorageAdaptiveGroups(limit:1000, filter:{datetime_geq:$since, datetime_leq:$until}) {
        dimensions { databaseId datetime }
        max { databaseSizeBytes }
      }
      doInvocations: durableObjectsInvocationsAdaptiveGroups(limit:100, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
        dimensions { namespaceId objectId status }
        sum { requests errors wallTime }
        quantiles { cpuTimeP50 cpuTimeP95 wallTimeP50 }
      }
      scheduled: workersInvocationsScheduled(limit:1000, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
        datetime cron status cpuTimeUs
      }
    } }
  }`,
  { account, script: worker, db: dbId, since: since.toISOString(), until: until.toISOString() },
);

const workers = accountData.workersTotals.reduce(
  (acc, row) => {
    acc.requests += row.sum.requests || 0;
    acc.errors += row.sum.errors || 0;
    acc.subrequests += row.sum.subrequests || 0;
    acc.cpuP50 = Math.max(acc.cpuP50, row.quantiles.cpuTimeP50 || 0);
    acc.cpuP95 = Math.max(acc.cpuP95, row.quantiles.cpuTimeP95 || 0);
    acc.cpuP99 = Math.max(acc.cpuP99, row.quantiles.cpuTimeP99 || 0);
    return acc;
  },
  { requests: 0, errors: 0, subrequests: 0, cpuP50: 0, cpuP95: 0, cpuP99: 0 },
);

const statusCounts = {};
for (const row of accountData.workersByStatus) {
  const status = row.dimensions.status || "unknown";
  statusCounts[status] = (statusCounts[status] || 0) + (row.sum.requests || 0);
}

const d1 = accountData.d1Totals.reduce(
  (acc, row) => {
    acc.rowsRead += row.sum.rowsRead || 0;
    acc.rowsWritten += row.sum.rowsWritten || 0;
    acc.readQueries += row.sum.readQueries || 0;
    acc.writeQueries += row.sum.writeQueries || 0;
    acc.responseBytes += row.sum.queryBatchResponseBytes || 0;
    acc.p50 = Math.max(acc.p50, row.quantiles.queryBatchTimeMsP50 || 0);
    acc.p95 = Math.max(acc.p95, row.quantiles.queryBatchTimeMsP95 || 0);
    return acc;
  },
  { rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0, responseBytes: 0, p50: 0, p95: 0 },
);

const dbSizes = new Map();
for (const row of accountData.d1StorageAll) {
  const id = row.dimensions.databaseId;
  dbSizes.set(id, Math.max(dbSizes.get(id) || 0, row.max.databaseSizeBytes || 0));
}
const dbSize = dbSizes.get(dbId) || 0;
const accountDbBytes = [...dbSizes.values()].reduce((sum, value) => sum + value, 0);

const namespaceIds = [...new Set(accountData.doInvocations.map((row) => row.dimensions.namespaceId).filter(Boolean))];
let doPeriodic = [];
let doStorage = [];
if (namespaceIds.length) {
  const periodic = await gql(
    `query($account:String!,$ns:[String!]!,$since:Time!,$until:Time!){
      viewer { accounts(filter:{accountTag:$account}) {
        durableObjectsPeriodicGroups(limit:1000, filter:{namespaceId_in:$ns, datetime_geq:$since, datetime_leq:$until}) {
          dimensions { namespaceId objectId }
          sum { activeTime cpuTime duration exceededCpuErrors exceededMemoryErrors fatalInternalErrors rowsRead rowsWritten storageReadUnits storageWriteUnits subrequests }
          quantiles { memoryUsageBytesP50 memoryUsageBytesP95 memoryUsageBytesP99 }
        }
        durableObjectsStorageGroups(limit:1000, filter:{datetime_geq:$since, datetime_leq:$until}) {
          dimensions { namespaceIds datetime }
          max { storedBytes }
        }
      } }
    }`,
    { account, ns: namespaceIds, since: since.toISOString(), until: until.toISOString() },
  );
  doPeriodic = periodic.durableObjectsPeriodicGroups || [];
  doStorage = (periodic.durableObjectsStorageGroups || []).filter((row) =>
    (row.dimensions.namespaceIds || []).some((id) => namespaceIds.includes(id)),
  );
}

const doStats = { requests: 0, errors: 0, cpuP50: 0, cpuP95: 0, cpuTotalUs: 0, exceededCpu: 0, exceededMemory: 0, fatal: 0, rowsRead: 0, rowsWritten: 0, memoryP95: 0, duration: 0, wallTime: 0 };
for (const row of accountData.doInvocations) {
  doStats.requests += row.sum.requests || 0;
  doStats.errors += row.sum.errors || 0;
  doStats.wallTime += row.sum.wallTime || 0;
  doStats.cpuP50 = Math.max(doStats.cpuP50, row.quantiles.cpuTimeP50 || 0);
  doStats.cpuP95 = Math.max(doStats.cpuP95, row.quantiles.cpuTimeP95 || 0);
}
for (const row of doPeriodic) {
  doStats.cpuTotalUs += row.sum.cpuTime || 0;
  doStats.exceededCpu += row.sum.exceededCpuErrors || 0;
  doStats.exceededMemory += row.sum.exceededMemoryErrors || 0;
  doStats.fatal += row.sum.fatalInternalErrors || 0;
  doStats.rowsRead += row.sum.rowsRead || 0;
  doStats.rowsWritten += row.sum.rowsWritten || 0;
  doStats.duration += row.sum.duration || 0;
  doStats.memoryP95 = Math.max(doStats.memoryP95, row.quantiles.memoryUsageBytesP95 || 0);
}
const doStoredBytes = doStorage.reduce((max, row) => Math.max(max, row.max.storedBytes || 0), 0);

const cron = { total: 0, success: 0, failed: 0, lastRun: null, cpuTotalUs: 0, crons: new Set() };
for (const row of accountData.scheduled) {
  cron.total += 1;
  if ((row.status || "").toLowerCase() === "success") cron.success += 1;
  else cron.failed += 1;
  cron.cpuTotalUs += row.cpuTimeUs || 0;
  cron.crons.add(row.cron);
  if (!cron.lastRun || new Date(row.datetime) > new Date(cron.lastRun)) cron.lastRun = row.datetime;
}

const scale = 24 / hours;
const quotaReliable = hours >= 6;
const cpuP95Ms = workers.cpuP95 / 1000;
const cpuCheck = {
  metric: "Workers CPU P95",
  used: Number(cpuP95Ms.toFixed(2)),
  quota: FREE.workersCpuMsPerRequest,
  unit: "ms/request",
  ratio: Number((cpuP95Ms / FREE.workersCpuMsPerRequest).toFixed(4)),
  status: cpuP95Ms > FREE.workersCpuMsPerRequest ? "HIGH" : cpuP95Ms > 7 ? "WARN" : "OK",
  note: "Per-request soft limit; 7 ms is the M3.5 operating target. Cold starts dominate the P95.",
};
if (["WARN", "HIGH"].includes(cpuCheck.status)) findings.push(cpuCheck);
const checks = [
  record("Workers requests (24h)", Math.round(workers.requests * scale), FREE.workersRequestsPerDay, "requests", quotaReliable ? "" : "Short window projection; quota status suppressed.", quotaReliable),
  cpuCheck,
  record("D1 rows read (24h)", Math.round(d1.rowsRead * scale), FREE.d1RowsReadPerDay, "rows", quotaReliable ? "" : "Short window projection; quota status suppressed.", quotaReliable),
  record("D1 rows written (24h)", Math.round(d1.rowsWritten * scale), FREE.d1RowsWrittenPerDay, "rows", quotaReliable ? "" : "Short window projection; quota status suppressed.", quotaReliable),
  record("D1 database size", dbSize, FREE.d1StoragePerDatabaseBytes, "bytes", config.d1_databases[0].database_name),
  record("D1 account size", accountDbBytes, FREE.d1StoragePerAccountBytes, "bytes", `${dbSizes.size} database(s)`),
  record("Durable Object requests (24h)", Math.round(doStats.requests * scale), FREE.durableObjectRequestsPerDay, "requests", quotaReliable ? "" : "Short window projection; quota status suppressed.", quotaReliable),
];

let cronHeartbeat = null;
let cronHeartbeatError = null;
try {
  const rows = await d1Query("SELECT key, value FROM settings WHERE key IN ('cron_last_run','cron_last_error')");
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  cronHeartbeat = map.cron_last_run ? JSON.parse(map.cron_last_run) : null;
  cronHeartbeatError = map.cron_last_error ? JSON.parse(map.cron_last_error) : null;
} catch (error) {
  cronHeartbeatError = { ok: false, error: error.message };
}
const heartbeatAgeMinutes = cronHeartbeat?.at ? (Date.now() - new Date(cronHeartbeat.at).getTime()) / 60_000 : null;
const cronCheck = {
  metric: "Cron heartbeat age",
  used: heartbeatAgeMinutes === null ? null : Number(heartbeatAgeMinutes.toFixed(1)),
  quota: 15,
  unit: "minutes",
  ratio: heartbeatAgeMinutes === null ? null : Number((heartbeatAgeMinutes / 15).toFixed(4)),
  status:
    heartbeatAgeMinutes === null || cronHeartbeat?.ok === false
      ? "CRIT"
      : heartbeatAgeMinutes > 15
        ? "HIGH"
        : "OK",
  note: "Cron runs every 5 minutes; heartbeat stored in settings.cron_last_run.",
};
if (cronCheck.status !== "OK") findings.push(cronCheck);

const health = {};
for (const route of ["/api/v1/health", "/sitemap.xml", "/rss.xml", "/robots.txt"]) {
  const started = performance.now();
  try {
    const response = await fetch(site + route, {
      headers: { "user-agent": "Mozilla/5.0 M5-Monitor" },
      signal: AbortSignal.timeout(20_000),
    });
    health[route] = { status: response.status, ms: Math.round(performance.now() - started) };
  } catch (error) {
    health[route] = { status: "ERR", error: error.message, ms: Math.round(performance.now() - started) };
  }
}

const backupPath = getArg("--backup", "backups/m5-source-data.sql.enc");
let backup = { path: backupPath, exists: false };
if (fs.existsSync(backupPath)) {
  const stat = fs.statSync(backupPath);
  backup = {
    path: backupPath,
    exists: true,
    bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
    age_hours: Number(((Date.now() - stat.mtimeMs) / 3_600_000).toFixed(1)),
    stale: Date.now() - stat.mtimeMs > 7 * 24 * 3_600_000,
  };
  if (backup.stale) findings.push({ metric: "Encrypted backup age", used: backup.age_hours, quota: 168, unit: "hours", status: "WARN" });
}

const errorRate = workers.requests ? workers.errors / workers.requests : 0;
const statusClass = (prefix) => Object.entries(statusCounts).filter(([status]) => status.startsWith(prefix)).reduce((sum, [, count]) => sum + count, 0);
const result = {
  generated_at: now.toISOString(),
  window_hours: hours,
  worker,
  worker_version: config.vars.ENVIRONMENT || "unknown",
  d1: { id: dbId, name: config.d1_databases[0].database_name },
  workers: {
    requests: workers.requests,
    projected_24h: Math.round(workers.requests * scale),
    errors: workers.errors,
    error_rate: Number(errorRate.toFixed(4)),
    subrequests: workers.subrequests,
    cpu_p50_ms: Number((workers.cpuP50 / 1000).toFixed(3)),
    cpu_p95_ms: Number((workers.cpuP95 / 1000).toFixed(3)),
    cpu_p99_ms: Number((workers.cpuP99 / 1000).toFixed(3)),
    status_counts: statusCounts,
    unauthorized: statusClass("401"),
    forbidden: statusClass("403"),
    rate_limited: statusClass("429"),
    server_errors: statusClass("5"),
  },
  d1_stats: {
    rows_read: d1.rowsRead,
    rows_written: d1.rowsWritten,
    projected_rows_read_24h: Math.round(d1.rowsRead * scale),
    projected_rows_written_24h: Math.round(d1.rowsWritten * scale),
    read_queries: d1.readQueries,
    write_queries: d1.writeQueries,
    p50_ms: d1.p50,
    p95_ms: d1.p95,
    database_size_bytes: dbSize,
    account_size_bytes: accountDbBytes,
    databases_seen: dbSizes.size,
  },
  durable_objects: {
    namespace_ids: namespaceIds,
    requests: doStats.requests,
    projected_requests_24h: Math.round(doStats.requests * scale),
    errors: doStats.errors,
    cpu_total_us: doStats.cpuTotalUs,
    cpu_p50_ms: Number((doStats.cpuP50 / 1000).toFixed(3)),
    cpu_p95_ms: Number((doStats.cpuP95 / 1000).toFixed(3)),
    memory_p95_bytes: doStats.memoryP95,
    exceeded_cpu_errors: doStats.exceededCpu,
    exceeded_memory_errors: doStats.exceededMemory,
    fatal_internal_errors: doStats.fatal,
    rows_read: doStats.rowsRead,
    rows_written: doStats.rowsWritten,
    stored_bytes: doStoredBytes,
    note: "Periodic cpuTime/duration units follow the GraphQL schema; treat as diagnostic, not billing.",
  },
  cron: {
    runs: cron.total,
    success: cron.success,
    failed: cron.failed,
    last_run: cron.lastRun,
    cpu_total_us: cron.cpuTotalUs,
    cron_expressions: [...cron.crons],
    heartbeat: cronHeartbeat,
    heartbeat_error: cronHeartbeatError,
    heartbeat_age_minutes: heartbeatAgeMinutes === null ? null : Number(heartbeatAgeMinutes.toFixed(1)),
    check: cronCheck,
  },
  health,
  backup,
  checks,
  findings,
  limits: FREE,
  thresholds: THRESHOLDS,
};

fs.mkdirSync("fixtures", { recursive: true });
fs.writeFileSync("fixtures/m5-monitor-latest.json", JSON.stringify(result, null, 2));

console.log(`M5 monitor ${now.toISOString()} — ${worker} / ${config.d1_databases[0].database_name}`);
console.log(`Workers: ${workers.requests} req (${Math.round(workers.requests * scale)}/24h), CPU P50 ${(workers.cpuP50 / 1000).toFixed(2)} ms, P95 ${(workers.cpuP95 / 1000).toFixed(2)} ms, errors ${workers.errors}`);
console.log(`HTTP: 401=${result.workers.unauthorized} 403=${result.workers.forbidden} 429=${result.workers.rate_limited} 5xx=${result.workers.server_errors}`);
console.log(`D1: ${d1.rowsRead} read / ${d1.rowsWritten} written; size ${(dbSize / 1048576).toFixed(2)} MB / 500 MB; account ${(accountDbBytes / 1048576).toFixed(2)} MB / 5 GB`);
console.log(`DO: ${doStats.requests} req; CPU total ${doStats.cpuTotalUs} us; exceeded cpu=${doStats.exceededCpu} memory=${doStats.exceededMemory}; memory P95 ${(doStats.memoryP95 / 1048576).toFixed(2)} MB`);
console.log(`Cron: ${cron.success}/${cron.total} scheduled events; heartbeat ${cronHeartbeat?.at || "missing"} (${heartbeatAgeMinutes === null ? "n/a" : heartbeatAgeMinutes.toFixed(1)} min ago), ok=${cronHeartbeat?.ok}`);
console.log(`Health: ${Object.entries(health).map(([route, value]) => `${route}=${value.status}`).join(" ")}`);
if (findings.length) {
  console.log("\nFindings:");
  for (const item of findings) console.log(`- [${item.status}] ${item.metric}: ${item.used}/${item.quota} ${item.unit} (${(item.ratio * 100).toFixed(1)}%) ${item.note}`);
} else {
  console.log("\nAll checked quotas below 50%.");
}
const critical = findings.some((item) => item.status === "CRIT" || item.status === "HIGH");
process.exitCode = critical ? 2 : 0;
