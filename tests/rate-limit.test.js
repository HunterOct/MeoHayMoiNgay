import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prepareEnv, startServer, stopServer, cleanupDir, makeClient } from "./support.js";

const dir = prepareEnv("mh-rate");
process.env.RATE_LIMIT_HTML_PER_MIN = "3";
const ctx = await startServer();
const client = makeClient(ctx.base);

after(async () => {
  await stopServer(ctx);
  cleanupDir(dir);
});

test("public HTML rate limit applies per IP and sends Retry-After", async () => {
  const statuses = [];
  let limited;
  for (let i = 0; i < 4; i += 1) {
    const res = await client.request("/");
    statuses.push(res.status);
    if (res.status === 429) limited = res;
  }
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  assert.equal(statuses[3], 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(limited.headers.get("x-ratelimit-limit"), "3");
});
