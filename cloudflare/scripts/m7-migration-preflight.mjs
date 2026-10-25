import fs from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const sourcePath = process.argv[2] || "D:/Github/MeoHayMoiNgay/data/blog.db";
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
const dbId = config.d1_databases[0].database_id;

async function d1(sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${dbId}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(JSON.stringify(payload.errors || payload));
  return payload.result?.[0]?.results || [];
}

const source = new DatabaseSync(sourcePath, { readOnly: true });
const hash = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
const postHash = (post) =>
  hash([
    post.id, post.slug, post.title, post.excerpt, post.content_html, post.content_source,
    post.content_format, post.status, post.category_id, post.author_id, post.cover_image,
    post.cover_alt, post.cover_caption, post.seo_title, post.seo_description,
    post.focus_keyword, post.canonical_url, post.og_image, post.is_featured,
    post.read_minutes, post.published_at, post.scheduled_at, post.deleted_at,
  ].join("\u0000"));

const sourcePosts = source.prepare("SELECT * FROM posts ORDER BY id").all();
const targetPosts = await d1(
  "SELECT id,slug,title,excerpt,content_html,content_source,content_format,status,category_id,author_id,cover_image,cover_alt,cover_caption,seo_title,seo_description,focus_keyword,canonical_url,og_image,is_featured,read_minutes,published_at,scheduled_at,deleted_at FROM posts ORDER BY id",
);
const sourceById = new Map(sourcePosts.map((post) => [post.id, post]));
const targetById = new Map(targetPosts.map((post) => [post.id, post]));
const missingInTarget = [...sourceById.keys()].filter((id) => !targetById.has(id));
const extraInTarget = [...targetById.keys()].filter((id) => !sourceById.has(id));
const compareFields = [
  "slug", "title", "excerpt", "content_html", "content_source", "content_format", "status",
  "category_id", "author_id", "cover_image", "cover_alt", "cover_caption", "seo_title",
  "seo_description", "focus_keyword", "canonical_url", "og_image", "is_featured",
  "read_minutes", "published_at", "scheduled_at", "deleted_at",
];
const contentHash = (post) =>
  postHash({ ...post, author_id: "" });
const changedContent = [...sourceById.keys()].filter(
  (id) => targetById.has(id) && contentHash(sourceById.get(id)) !== contentHash(targetById.get(id)),
);
const changed = [...sourceById.keys()]
  .filter((id) => targetById.has(id) && postHash(sourceById.get(id)) !== postHash(targetById.get(id)))
  .map((id) => {
    const left = sourceById.get(id);
    const right = targetById.get(id);
    return { id, slug: left.slug, fields: compareFields.filter((field) => String(left[field] ?? "") !== String(right[field] ?? "")) };
  });

const sourceTags = source.prepare("SELECT name,slug FROM tags ORDER BY slug").all();
const targetTags = await d1("SELECT name,slug FROM tags ORDER BY slug");
const targetCategories = await d1("SELECT id,name,slug,group_name,cached_post_count FROM categories ORDER BY slug");
const sourceCategories = source.prepare("SELECT id,name,slug,group_name FROM categories ORDER BY slug").all();
const targetCounts = (await d1(`SELECT
  (SELECT COUNT(*) FROM posts) posts,
  (SELECT COUNT(*) FROM posts WHERE status='published' AND deleted_at IS NULL) published,
  (SELECT COUNT(*) FROM revisions) revisions,
  (SELECT COUNT(*) FROM categories) categories,
  (SELECT COUNT(*) FROM tags) tags,
  (SELECT COUNT(*) FROM post_tags) post_tags,
  (SELECT COUNT(*) FROM posts_fts) fts,
  (SELECT value FROM counters WHERE key='published_posts') counter_published,
  (SELECT COUNT(*) FROM posts WHERE version >= 1) versioned,
  (SELECT COUNT(*) FROM posts WHERE change_id <> '') identified`))[0];

const sourceCounts = {
  posts: sourcePosts.length,
  published: sourcePosts.filter((post) => post.status === "published" && !post.deleted_at).length,
  revisions: source.prepare("SELECT COUNT(*) AS n FROM revisions").get().n,
  categories: source.prepare("SELECT COUNT(*) AS n FROM categories").get().n,
  tags: source.prepare("SELECT COUNT(*) AS n FROM tags").get().n,
  post_tags: source.prepare("SELECT COUNT(*) AS n FROM post_tags").get().n,
  fts: source.prepare("SELECT COUNT(*) AS n FROM posts_fts").get().n,
};

const result = {
  generated_at: new Date().toISOString(),
  source: sourcePath,
  target_database: config.d1_databases[0].database_name,
  source_counts: sourceCounts,
  target_counts: targetCounts,
  checks: {
    posts_count: sourceCounts.posts === targetCounts.posts,
    published_count: sourceCounts.published === targetCounts.published,
    categories_count: sourceCounts.categories === targetCounts.categories,
    tags_count: sourceCounts.tags === targetCounts.tags,
    post_tags_count: sourceCounts.post_tags === targetCounts.post_tags,
    no_missing_posts: missingInTarget.length === 0,
    no_extra_posts: extraInTarget.length === 0,
    content_hashes_match: changed.length === 0,
    content_hashes_match_ignoring_author: changedContent.length === 0,
    category_slugs_match: sourceCategories.every((row, index) => targetCategories[index]?.slug === row.slug),
    tag_slugs_match: sourceTags.every((row, index) => targetTags[index]?.slug === row.slug),
    fts_rebuilt: targetCounts.fts === targetCounts.posts,
    counters_match: Number(targetCounts.counter_published) === targetCounts.published,
    version_change_id_present: targetCounts.versioned === targetCounts.posts && targetCounts.identified === targetCounts.posts,
  },
  staging_gaps: {
    revisions: { source: sourceCounts.revisions, target: targetCounts.revisions, note: "Staging translation fixture did not import Node revisions; production migration must import them." },
    author_id: { source: [...new Set(sourcePosts.map((post) => post.author_id))], target: [...new Set(targetPosts.map((post) => post.author_id))], note: "Staging uses synthetic user-m0-admin; production migration must preserve Node user IDs or map them." },
    users: { source: source.prepare("SELECT COUNT(*) AS n FROM users").get().n, target: (await d1("SELECT COUNT(*) AS n FROM users"))[0].n, note: "Target includes staging test users." },
    api_clients: { source: source.prepare("SELECT COUNT(*) AS n FROM api_clients").get().n, target: (await d1("SELECT COUNT(*) AS n FROM api_clients"))[0].n, note: "Target includes staging test API clients." },
  },
  missing_in_target: missingInTarget.slice(0, 20),
  extra_in_target: extraInTarget.slice(0, 20),
  changed_total: changed.length,
  changed_content_total: changedContent.length,
  changed_posts: changed.slice(0, 20),
};
source.close();
fs.writeFileSync("fixtures/m7-migration-preflight.json", JSON.stringify(result, null, 2));
const failed = Object.entries(result.checks).filter(([, ok]) => !ok);
console.log(JSON.stringify({ checks: result.checks, failed: failed.map(([name]) => name), source_counts: sourceCounts, target_counts: targetCounts, gapped: result.staging_gaps }, null, 2));
process.exitCode = failed.length ? 1 : 0;
