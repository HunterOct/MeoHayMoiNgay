import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const fixture = JSON.parse(fs.readFileSync("fixtures/articles.json", "utf8"));
const now = new Date().toISOString();

const q = (value) => `'${String(value ?? "").replace(/'/g, "''")}'`;
const plain = (html) =>
  String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const adminId = "user-m0-admin";
const password = "M0-Test-Password-123";
const salt = crypto.randomBytes(16);
const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 * 2 });
const passwordHash = ["scrypt", 16384, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");

const apiSecret = crypto.randomBytes(32).toString("base64url");
const apiKeyId = crypto.randomBytes(5).toString("hex");
const apiKey = `mh_${apiKeyId}_${apiSecret}`;
const apiKeyHash = crypto.createHash("sha256").update(apiSecret).digest("hex");
const reviewSecret = crypto.randomBytes(32).toString("base64url");
const reviewKeyId = crypto.randomBytes(5).toString("hex");
const reviewKey = `mh_${reviewKeyId}_${reviewSecret}`;
const reviewKeyHash = crypto.createHash("sha256").update(reviewSecret).digest("hex");

const lines = [];
lines.push(`INSERT INTO users (id,email,password_hash,name,role,is_active,created_at) VALUES (${q(adminId)},'m0@test.local',${q(passwordHash)},'M0 Admin','admin',1,${q(now)});`);
lines.push(`INSERT INTO api_clients (id,name,key_id,key_hash,scopes,publish_mode,rate_limit_per_min,is_active,created_at) VALUES ('client-m0-auto','M0 Auto',${q(apiKeyId)},${q(apiKeyHash)},'["posts:read","posts:write","posts:publish","media:write"]','auto',600,1,${q(now)});`);
lines.push(`INSERT INTO api_clients (id,name,key_id,key_hash,scopes,publish_mode,rate_limit_per_min,is_active,created_at) VALUES ('client-m0-review','M0 Review',${q(reviewKeyId)},${q(reviewKeyHash)},'["posts:read","posts:write"]','review',600,1,${q(now)});`);

for (const category of fixture.categories) {
  lines.push(
    `INSERT INTO categories (id,name,slug,group_name,description,sort_order) VALUES (${q(category.id)},${q(category.name)},${q(category.slug)},${q(category.group_name)},${q(category.description)},${category.sort_order});`,
  );
}
for (const tag of fixture.tags) {
  lines.push(`INSERT INTO tags (id,name,slug) VALUES (${q(tag.id)},${q(tag.name)},${q(tag.slug)});`);
}

const categoryBySlug = new Map(fixture.categories.map((c) => [c.slug, c]));
const tagByName = new Map(fixture.tags.map((t) => [t.name, t]));

for (const post of fixture.posts) {
  const category = categoryBySlug.get(post.category_slug);
  lines.push(
    `INSERT INTO posts (id,slug,title,excerpt,lede,content_html,content_source,content_format,status,category_id,author_id,cover_image,cover_alt,cover_caption,seo_title,seo_description,focus_keyword,canonical_url,og_image,is_featured,read_minutes,views,published_at,scheduled_at,created_at,updated_at) VALUES (${q(post.id)},${q(post.slug)},${q(post.title)},${q(post.excerpt)},${q(post.lede)},${q(post.content_html)},${q(post.content_source || post.content_html)},${q(post.content_format)},'published',${category ? q(category.id) : "NULL"},${q(adminId)},${q(post.cover_image)},${q(post.cover_alt)},${q(post.cover_caption)},${q(post.seo_title)},${q(post.seo_description)},${q(post.focus_keyword)},${q(post.canonical_url)},${q(post.og_image)},${post.is_featured ? 1 : 0},${post.read_minutes || 4},0,${q(post.published_at)},NULL,${q(post.created_at || post.published_at)},${q(post.updated_at || post.published_at)});`,
  );
  for (const tag of post.tags || []) {
    const found = tagByName.get(tag.name);
    if (found) lines.push(`INSERT INTO post_tags (post_id,tag_id) VALUES (${q(post.id)},${q(found.id)});`);
  }
  lines.push(
    `INSERT INTO posts_fts (post_id,title,excerpt,content) VALUES (${q(post.id)},${q(post.title)},${q(post.excerpt)},${q(plain(post.content_html))});`,
  );
}

// Three due scheduled posts for Cron testing.
for (let i = 1; i <= 3; i += 1) {
  const base = fixture.posts[i - 1];
  const id = `sched-m0-${i}`;
  const slug = `sched-m0-${i}`;
  const scheduledAt = new Date(Date.now() - i * 60_000).toISOString();
  const category = categoryBySlug.get(base.category_slug);
  lines.push(
    `INSERT INTO posts (id,slug,title,excerpt,lede,content_html,content_source,content_format,status,category_id,author_id,cover_image,cover_alt,cover_caption,seo_title,seo_description,focus_keyword,canonical_url,og_image,is_featured,read_minutes,views,published_at,scheduled_at,created_at,updated_at) VALUES (${q(id)},${q(slug)},${q("SCHEDULED " + base.title)},${q(base.excerpt)},${q(base.lede)},${q(base.content_html)},${q(base.content_source || base.content_html)},'html','scheduled',${category ? q(category.id) : "NULL"},${q(adminId)},${q(base.cover_image)},${q(base.cover_alt)},${q(base.cover_caption)},${q(base.seo_title)},${q(base.seo_description)},${q(base.focus_keyword)},${q(base.canonical_url)},${q(base.og_image)},0,${base.read_minutes || 4},0,NULL,${q(scheduledAt)},${q(now)},${q(now)});`,
  );
  lines.push(
    `INSERT INTO posts_fts (post_id,title,excerpt,content) VALUES (${q(id)},${q("SCHEDULED " + base.title)},${q(base.excerpt)},${q(plain(base.content_html))});`,
  );
}

fs.writeFileSync("fixtures/seed.sql", lines.join("\n"));
fs.writeFileSync(
  "fixtures/seed-meta.json",
  JSON.stringify(
    {
      adminId,
      password,
      passwordHash,
      apiKeyId,
      apiKey,
      apiKeyHash,
      reviewKey,
      reviewKeyHash,
      passwordParams: { N: 16384, r: 8, p: 1 },
      generatedAt: now,
      counts: fixture.counts,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    seedBytes: fs.statSync("fixtures/seed.sql").size,
    posts: fixture.posts.length,
    categories: fixture.categories.length,
    tags: fixture.tags.length,
    scheduled: 3,
    note: "Test credentials are prototype-only and stored under the isolated spike directory.",
  }),
);
