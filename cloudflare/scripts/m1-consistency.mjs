import fs from "node:fs";
import { spawnSync } from "node:child_process";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const TOKEN = fs.readFileSync(".staging-token", "utf8").trim();
const meta = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const stamp = Date.now().toString(36);
const slug = `m1-consistency-${stamp}`;
const newSlug = `${slug}-renamed`;
const marker = `M1CONSISTENCY${stamp.toUpperCase()}`;
const title = `Kiểm chứng nội dung ${marker}`;
const category = "wifi-mang";
const tag = "kiem-thu";
const results = [];

function ua() {
  return { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141 M1-Consistency" };
}

async function request(path, { method = "GET", body, key } = {}) {
  const headers = { ...ua(), "x-staging-token": TOKEN };
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
        redirect: "manual",
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, text };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

function check(name, condition, detail = "") {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function contains(path, needle) {
  const response = await request(path);
  return { status: response.status, has: response.text.includes(needle) };
}

function d1(sql) {
  const file = "fixtures/.tmp-m1-consistency.sql";
  fs.writeFileSync(file, sql);
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = spawnSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "meohay-m0-stg-230403", "--remote",
        "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--file", file,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    if (last.status === 0) return last.stdout;
  }
  throw new Error(`D1 failed: ${last?.stderr || last?.stdout || "unknown"}`);
}

async function categoryCount() {
  const response = await request(`/api/m0/bench/category/${category}`);
  return JSON.parse(response.text).total;
}

const beforeCount = await categoryCount();
const create = await request("/api/m0/posts", {
  method: "POST",
  key: meta.apiKey,
  body: {
    title,
    slug,
    excerpt: `M1 consistency ${marker}`,
    content: `<h2>Kiểm chứng</h2><p>${marker} Nội dung kiểm chứng tính nhất quán public site. </p>`,
    content_format: "html",
    category,
    tags: [tag],
    status: "draft",
  },
});
const id = JSON.parse(create.text).data?.id;
check("create draft", create.status === 201 && Boolean(id), `status=${create.status}`);

for (const path of ["/", "/bai-viet", "/chuyen-muc/wifi-mang", "/the/kiem-thu", "/sitemap.xml", "/rss.xml"]) {
  const hit = await contains(path, slug);
  check(`draft hidden ${path}`, !hit.has, `status=${hit.status}`);
}
check("draft article 404", (await request(`/bai-viet/${slug}`)).status === 404);

const publish = await request(`/api/m0/posts/${id}/publish`, { method: "POST", key: meta.apiKey });
check("publish", publish.status === 200, `status=${publish.status}`);
const afterPublishCount = await categoryCount();
check("cached category count +1", afterPublishCount === beforeCount + 1, `${beforeCount} -> ${afterPublishCount}`);

const article = await request(`/bai-viet/${slug}`);
check("published article 200", article.status === 200);
check("article title", article.text.includes(marker));
check("article canonical", article.text.includes(`/bai-viet/${slug}`));
for (const path of ["/", "/bai-viet", "/chuyen-muc/wifi-mang", "/the/kiem-thu", "/sitemap.xml", "/rss.xml"]) {
  const hit = await contains(path, slug);
  check(`published visible ${path}`, hit.has, `status=${hit.status}`);
}
const search = await contains(`/tim-kiem?q=${encodeURIComponent(marker)}`, slug);
check("published search visible", search.has, `status=${search.status}`);

const updatedTitle = `${title} đã sửa`;
const patch = await request(`/api/m0/posts/${id}`, {
  method: "PATCH",
  key: meta.apiKey,
  body: { title: updatedTitle },
});
check("update title", patch.status === 200);
const afterUpdate = await request(`/bai-viet/${slug}`);
check("update reflected", afterUpdate.text.includes("đã sửa"));

const now = new Date().toISOString();
d1(`INSERT INTO slug_history (post_id,slug,created_at) VALUES ('${id}','${slug}','${now}'); UPDATE posts SET slug='${newSlug}', updated_at='${now}' WHERE id='${id}';`);
const oldUrl = await request(`/bai-viet/${slug}`);
const newUrl = await request(`/bai-viet/${newSlug}`);
check("old slug 301", oldUrl.status === 301 && oldUrl.headers.get("location") === `/bai-viet/${newSlug}`, `status=${oldUrl.status}`);
check("new slug 200", newUrl.status === 200);
check("sitemap new slug only", (await contains("/sitemap.xml", newSlug)).has && !(await contains("/sitemap.xml", `/${slug}<`)).has);

const unpublish = await request(`/api/m0/posts/${id}`, {
  method: "PATCH",
  key: meta.apiKey,
  body: { status: "draft" },
});
check("unpublish", unpublish.status === 200);
const afterUnpublishCount = await categoryCount();
check("cached category count -1", afterUnpublishCount === beforeCount, `${afterPublishCount} -> ${afterUnpublishCount}`);
check("unpublished article 404", (await request(`/bai-viet/${newSlug}`)).status === 404);
for (const path of ["/", "/bai-viet", "/chuyen-muc/wifi-mang", "/sitemap.xml", "/rss.xml"]) {
  check(`unpublished hidden ${path}`, !(await contains(path, newSlug)).has);
}

await request(`/api/m0/posts/${id}`, { method: "PATCH", key: meta.apiKey, body: { status: "published" } });
const deletedAt = new Date().toISOString();
d1(`UPDATE posts SET deleted_at='${deletedAt}', updated_at='${deletedAt}' WHERE id='${id}';`);
check("deleted article 410", (await request(`/bai-viet/${newSlug}`)).status === 410);
check("deleted absent home", !(await contains("/", newSlug)).has);
check("deleted absent sitemap", !(await contains("/sitemap.xml", newSlug)).has);
check("deleted cached count -1", (await categoryCount()) === beforeCount);

d1(`DELETE FROM posts_fts WHERE post_id='${id}'; DELETE FROM post_tags WHERE post_id='${id}'; DELETE FROM slug_history WHERE post_id='${id}'; DELETE FROM posts WHERE id='${id}';`);

const scheduleSlug = `m1-scheduled-${stamp}`;
const scheduled = await request("/api/m0/posts", {
  method: "POST",
  key: meta.apiKey,
  body: {
    title: `Bài lên lịch ${marker}`,
    slug: scheduleSlug,
    excerpt: "Scheduled consistency",
    content: `<p>${marker} scheduled content with enough length.</p>`,
    content_format: "html",
    category,
    status: "scheduled",
    scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
  },
});
const scheduledId = JSON.parse(scheduled.text).data?.id;
check("create scheduled", scheduled.status === 201 && Boolean(scheduledId));
check("future scheduled hidden", (await request(`/bai-viet/${scheduleSlug}`)).status === 404);
d1(`UPDATE posts SET scheduled_at='${new Date(Date.now() - 60_000).toISOString()}' WHERE id='${scheduledId}';`);
const cron = await request("/api/m0/cron/run", { method: "POST" });
check("cron publish scheduled", cron.status === 200, cron.text.slice(0, 160));
const scheduledArticle = await request(`/bai-viet/${scheduleSlug}`);
check("scheduled now visible", scheduledArticle.status === 200);
check("scheduled visible home", (await contains("/", scheduleSlug)).has);
d1(`DELETE FROM posts_fts WHERE post_id='${scheduledId}'; DELETE FROM post_tags WHERE post_id='${scheduledId}'; DELETE FROM posts WHERE id='${scheduledId}';`);

const failed = results.filter((item) => !item.pass);
const summary = { stamp, slug, newSlug, scheduleSlug, results, passed: results.length - failed.length, failed: failed.length };
fs.writeFileSync(`fixtures/m1-consistency-${stamp}.json`, JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${results.length} passed`);
if (failed.length) process.exit(1);
