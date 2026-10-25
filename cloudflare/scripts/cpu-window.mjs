import fs from "node:fs";

const minutes = Number(process.argv[2] || 10);
const script = process.env.STAGING_SCRIPT || "meohay-m0-stg-230403";
const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const query = `query($account:String!,$script:String!,$since:Time!,$until:Time!){
  viewer { accounts(filter:{accountTag:$account}) {
    workersInvocationsAdaptive(limit:10, filter:{scriptName:$script, datetime_geq:$since, datetime_leq:$until}) {
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
    }
  } }
}`;
const untilArg = process.argv[4] ? new Date(process.argv[4]) : null;
const sinceArg = process.argv[3] ? new Date(process.argv[3]) : null;
const until = untilArg && !Number.isNaN(untilArg.getTime()) ? untilArg : new Date();
const since = sinceArg && !Number.isNaN(sinceArg.getTime()) ? sinceArg : new Date(until.getTime() - minutes * 60_000);
const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: {
    authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    query,
    variables: { account: env.CLOUDFLARE_ACCOUNT_ID, script, since: since.toISOString(), until: until.toISOString() },
  }),
});
const payload = await response.json();
const rows = payload?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
const summary = rows.map((row) => ({
  requests: row.sum.requests,
  errors: row.sum.errors,
  subrequests: row.sum.subrequests,
  cpuP50_us: row.quantiles.cpuTimeP50,
  cpuP95_us: row.quantiles.cpuTimeP95,
  cpuP99_us: row.quantiles.cpuTimeP99,
  cpuP50_ms: row.quantiles.cpuTimeP50 === null ? null : Number((row.quantiles.cpuTimeP50 / 1000).toFixed(3)),
  cpuP95_ms: row.quantiles.cpuTimeP95 === null ? null : Number((row.quantiles.cpuTimeP95 / 1000).toFixed(3)),
  cpuP99_ms: row.quantiles.cpuTimeP99 === null ? null : Number((row.quantiles.cpuTimeP99 / 1000).toFixed(3)),
}));
console.log(JSON.stringify({ since: since.toISOString(), until: until.toISOString(), script, graphql_errors: payload.errors || null, summary, note: "CPU fields are microseconds; /1000 = ms." }, null, 2));
fs.writeFileSync(`fixtures/cpu-window-${minutes}m.json`, JSON.stringify({ since, until, script, payload }, null, 2));
