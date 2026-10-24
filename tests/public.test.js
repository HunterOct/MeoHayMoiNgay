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
} from "./support.js";

const dir = prepareEnv("mh-public");
const ctx = await startServer();
const client = makeClient(ctx.base);

const admin = await seedUser({
  email: "admin@test.local",
  password: "AdminPass12345",
  name: "Quản trị",
  role: "admin",
});
const category = await seedCategory({
  name: "Wifi & Mạng",
  slug: "wifi-mang",
  group: "tech",
  description: "Mẹo wifi",
});
const published = await seedPost({
  title: "Bài viết công khai về wifi",
  slug: "bai-viet-cong-khai",
  authorId: admin.id,
  categoryId: category.id,
  status: "published",
  content: "<h2>Đo</h2><p>Tốc độ mạng và đặt router đúng chỗ.</p>",
  excerpt: "Mô tả bài công khai.",
  tags: ["wifi chậm"],
  publishedAt: "2026-10-20T01:00:00.000Z",
});
const draft = await seedPost({
  title: "Bài nháp không được lộ",
  slug: "bai-nhap",
  authorId: admin.id,
  categoryId: category.id,
  status: "draft",
  publishedAt: null,
});
const scheduled = await seedPost({
  title: "Bài hẹn giờ",
  slug: "bai-hen-gio",
  authorId: admin.id,
  categoryId: category.id,
  status: "scheduled",
  scheduledAt: "2030-01-01T01:00:00.000Z",
});
const trashed = await seedPost({
  title: "Bài đã xóa",
  slug: "bai-da-xoa",
  authorId: admin.id,
  categoryId: category.id,
  status: "published",
  publishedAt: "2026-10-01T01:00:00.000Z",
});
const { softDelete } = await import("../src/db/posts.js");
softDelete(trashed.id);

after(async () => {
  await stopServer(ctx);
  cleanupDir(dir);
});

test("home renders real posts and SEO metadata", async () => {
  const res = await client.request("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /Bài viết công khai về wifi/);
  assert.doesNotMatch(res.text, /Bài nháp không được lộ/);
  assert.match(res.text, /rel="canonical" href="http:\/\/127\.0\.0\.1:3000\/"/);
  assert.match(res.text, /"@type":"WebSite"/);
  assert.match(res.text, /"@type":"Organization"/);
  assert.match(res.headers.get("content-security-policy"), /script-src 'self' 'nonce-/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("article is server-rendered with canonical, JSON-LD and tags", async () => {
  const res = await client.request("/bai-viet/bai-viet-cong-khai");
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Bài viết công khai về wifi<\/h1>/);
  assert.match(res.text, /<h2>Đo<\/h2>/);
  assert.match(res.text, /"@type":"BlogPosting"/);
  assert.match(res.text, /"@type":"BreadcrumbList"/);
  assert.match(res.text, /rel="tag"/);
  assert.match(res.text, /rel="canonical" href="http:\/\/127\.0\.0\.1:3000\/bai-viet\/bai-viet-cong-khai"/);
  const db = await getDb();
  const views = db.prepare("SELECT views FROM posts WHERE id = ?").get(published.id).views;
  assert.ok(views >= 1);
});

test("drafts and scheduled posts are not public; trashed posts return 410", async () => {
  assert.equal((await client.request("/bai-viet/bai-nhap")).status, 404);
  assert.equal((await client.request("/bai-viet/bai-hen-gio")).status, 404);
  const gone = await client.request("/bai-viet/bai-da-xoa");
  assert.equal(gone.status, 410);
  assert.match(gone.headers.get("cache-control"), /no-store/);
});

test("category, group, tag and search pages work", async () => {
  const categoryPage = await client.request("/chuyen-muc/wifi-mang");
  assert.equal(categoryPage.status, 200);
  assert.match(categoryPage.text, /Wifi &amp; Mạng/);

  const groupPage = await client.request("/nhom/cong-nghe");
  assert.equal(groupPage.status, 200);

  const tagPage = await client.request("/the/wifi-cham");
  assert.equal(tagPage.status, 200);
  assert.match(tagPage.text, /Bài viết công khai về wifi/);

  const search = await client.request("/tim-kiem?q=wifi");
  assert.equal(search.status, 200);
  assert.match(search.text, /Bài viết công khai về wifi/);
  assert.match(search.text, /<meta name="robots" content="noindex, nofollow"/);
});

test("pagination beyond range is 404", async () => {
  const res = await client.request("/bai-viet/trang/99");
  assert.equal(res.status, 404);
});

test("changing a slug creates a 301 from the old URL", async () => {
  const { updatePost } = await import("../src/db/posts.js");
  updatePost(published.id, { slug: "bai-viet-doi-ten" }, { actorType: "system" });
  const oldUrl = await client.request("/bai-viet/bai-viet-cong-khai");
  assert.equal(oldUrl.status, 301);
  assert.equal(oldUrl.location, "/bai-viet/bai-viet-doi-ten");
  const newUrl = await client.request("/bai-viet/bai-viet-doi-ten");
  assert.equal(newUrl.status, 200);
});

test("sitemap and RSS include published posts only", async () => {
  const sitemap = await client.request("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.text, /bai-viet-doi-ten/);
  assert.doesNotMatch(sitemap.text, /bai-nhap/);
  assert.match(sitemap.text, /<image:loc>/);

  const rss = await client.request("/rss.xml");
  assert.equal(rss.status, 200);
  assert.match(rss.text, /bai-viet-doi-ten/);
  assert.doesNotMatch(rss.text, /bai-nhap/);
});

test("robots.txt allows search engines and blocks AI crawlers", async () => {
  const res = await client.request("/robots.txt");
  assert.equal(res.status, 200);
  assert.match(res.text, /User-agent: Googlebot\nAllow: \//);
  assert.match(res.text, /User-agent: GPTBot\nDisallow: \//);
  assert.match(res.text, /Sitemap: http:\/\/127\.0\.0\.1:3000\/sitemap\.xml/);
});

test("admin is noindex and robots tag is set", async () => {
  const res = await client.request("/admin/login");
  assert.equal(res.status, 200);
  assert.match(res.text, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
});

test("bot guard blocks scrapers and AI crawlers but allows Googlebot", async () => {
  const scraper = await client.request("/", { ua: "curl/8.5.0" });
  assert.equal(scraper.status, 403);

  const ai = await client.request("/", { ua: "GPTBot/1.0" });
  assert.equal(ai.status, 403);

  const google = await client.request("/bai-viet/bai-viet-doi-ten", {
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  });
  assert.equal(google.status, 200);
});

test("not found pages are noindex and return 404", async () => {
  const res = await client.request("/khong-ton-tai");
  assert.equal(res.status, 404);
  assert.match(res.text, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(res.text, /Không tìm thấy trang/);
});
