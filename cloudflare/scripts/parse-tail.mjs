import fs from "node:fs";

const input = process.argv[2] || "fixtures/tail.jsonl";
const output = process.argv[3] || "fixtures/tail-summary.json";
if (!fs.existsSync(input)) {
  console.error(`Missing tail file: ${input}`);
  process.exit(2);
}

const lines = fs.readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean);
const entries = [];
let unknownShape = null;
for (const line of lines) {
  try {
    const item = JSON.parse(line);
    const event = item.event || item;
    const request = event.request || item.request || {};
    const cpu = event.cpuTime ?? item.cpuTime ?? request.cpuTime ?? null;
    const memory = event.memory ?? item.memory ?? null;
    if (!unknownShape && cpu === null) unknownShape = Object.keys(event).slice(0, 30);
    entries.push({
      outcome: event.outcome ?? item.outcome ?? null,
      script: event.scriptName ?? item.scriptName ?? null,
      url: request.url ?? null,
      method: request.method ?? null,
      cpuTime: typeof cpu === "number" ? cpu : null,
      memory: typeof memory === "number" ? memory : null,
      exceptions: (event.exceptions || item.exceptions || []).map((exception) => ({
        name: exception.name,
        message: exception.message,
      })),
      logs: (event.logs || item.logs || []).slice(0, 6),
    });
  } catch {
    // Ignore non-JSON lines.
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
const cpuValues = entries.map((entry) => entry.cpuTime).filter((value) => typeof value === "number");
const errors = entries.filter((entry) => entry.outcome && entry.outcome !== "ok");
const summary = {
  input,
  events: entries.length,
  errors: errors.length,
  cpuSamples: cpuValues.length,
  cpuP50: cpuValues.length ? percentile(cpuValues, 0.5) : null,
  cpuP95: cpuValues.length ? percentile(cpuValues, 0.95) : null,
  cpuMax: cpuValues.length ? Math.max(...cpuValues) : null,
  exceededCpu: entries.filter((entry) => entry.outcome === "exceededCpu").length,
  exceededMemory: entries.filter((entry) => entry.outcome === "exceededMemory").length,
  unknownShape,
  sample: entries.slice(0, 10),
  note:
    cpuValues.length === 0
      ? "No cpuTime field in tail events. Use the Workers dashboard Metrics CPU P50/P95 or GraphQL analytics; do not substitute wall time."
      : "cpuTime is reported by tail events; still verify dashboard metrics for aggregate/quota.",
};
fs.writeFileSync(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
