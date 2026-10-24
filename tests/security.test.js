import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  prepareEnv,
  startServer,
  stopServer,
  cleanupDir,
  seedUser,
  seedCategory,
  seedPost,
  makeClient,
  getDb,
  PNG_1PX,
} from "./support.js";

const dir = prepareEnv("mh-security");
process.env.RATE_LIMIT_HTML_PER_MIN = "1000";
const ctx = await startServer();
const client = makeClient(ctx.base);

const admin = await seedUser({
  email: "admin@test.local",
  password: "AdminPass12345",
  name: "Quản trị",
  role: "admin",
});
const category = await seedCategory({ name: "Mẹo vặt", slug: "meo-vat", group: "life" });

for (let i = 0; i < 45; i += 1) {
  await seedPost({
    title: `Bài tuần tự ${i}`,
    slug: `bai-tuan-tu-${i}`,
    authorId: admin.id,
    categoryId: category.id,
    status: "published",
    publishedAt: new Date(Date.UTC(2026, 8, 1, 1, 0, i)).toISOString(),
  });
}

after(async () => {
  await stopServer(ctx);
  cleanupDir(dir);
});

test("scraper UAs and AI crawlers are blocked", async () => {
  assert.equal((await client.request("/", { ua: "python-requests/2.32" })).status, 403);
  assert.equal((await client.request("/", { ua: "ClaudeBot/1.0" })).status, 403);
  assert.equal((await client.request("/", { ua: "Meta-ExternalAgent/1.1" })).status, 403);
});

test("hotlink protection blocks foreign referers and allows same-site/search engines", async () => {
  const { storeImage } = await import("../src/lib/uploads.js");
  const media = storeImage({
    buffer: PNG_1PX,
    originalName: "hotlink.png",
    alt: "Hotlink test",
    uploadedBy: null,
  });
  const path = `/media/${media.filename}`;

  const direct = await client.request(path);
  assert.equal(direct.status, 200);

  const foreign = await client.request(path, { headers: { referer: "https://evil.example/page" } });
  assert.equal(foreign.status, 403);

  const sameSite = await client.request(path, { headers: { referer: `${ctx.base}/bai-viet/bai-tuan-tu-0` } });
  assert.equal(sameSite.status, 200);

  const google = await client.request(path, { headers: { referer: "https://www.google.com/search?q=meo" } });
  assert.equal(google.status, 200);
});

test("sequential article enumeration is throttled, verified bots are exempt", async () => {
  let blocked = null;
  for (let i = 0; i < 41; i += 1) {
    const res = await client.request(`/bai-viet/bai-tuan-tu-${i}`);
    if (i < 40) assert.equal(res.status, 200);
    else blocked = res;
  }
  assert.equal(blocked.status, 429);
  assert.match(blocked.text, /Truy cập bất thường/);

  const google = await client.request("/bai-viet/bai-tuan-tu-0", {
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  });
  assert.equal(google.status, 200);

  const db = await getDb();
  const event = db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'security.article_enumeration'")
    .get().n;
  assert.ok(event >= 1);
});
