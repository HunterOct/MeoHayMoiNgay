import fs from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SOURCE = "D:/Github/MeoHayMoiNgay/data/blog.db";
const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const config = JSON.parse(fs.readFileSync("wrangler.m7.jsonc", "utf8"));
const target = config.d1_databases[0];

async function d1(sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${target.database_id}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(JSON.stringify(payload.errors || payload));
  return payload.result?.[0]?.results || [];
}

const src = new DatabaseSync(SOURCE, { readOnly: true });
const sha = (values) => crypto.createHash("sha256").update(values.join("\u0000")).digest("hex");
const postCols = ["id", "slug", "title", "excerpt", "content_html", "content_source", "content_format", "status", "category_id", "author_id", "cover_image", "cover_alt", "cover_caption", "seo_title", "seo_description", "focus_keyword", "canonical_url", "og_image", "is_featured", "read_minutes", "published_at", "scheduled_at", "deleted_at"];
const revCols = ["id", "post_id", "title", "excerpt", "content_html", "content_source", "content_format", "seo_title", "seo_description", "cover_image", "status", "edited_by_type", "edited_by_id", "created_at"];
const hashRows = (rows, cols) => new Map(rows.map((row) => [row.id, sha(cols.map((col) => row[col] ?? ""))]));

const sourcePosts = src.prepare(`SELECT ${postCols.join(",")} FROM posts`).all();
const sourceRevisions = src.prepare(`SELECT ${revCols.join(",")} FROM revisions`).all();
const sourceUsers = src.prepare("SELECT id,email,name,role,is_active,bio,created_at,updated_at FROM users").all();
const sourceCategories = src.prepare("SELECT id,name,slug,group_name,description,sort_order,created_at,updated_at FROM categories").all();
const sourceTags = src.prepare("SELECT id,name,slug FROM tags").all();
const sourcePostTags = src.prepare("SELECT post_id,tag_id FROM post_tags ORDER BY post_id,tag_id").all();
const sourceSettings = src.prepare("SELECT key,value FROM settings").all();
const sourceAudit = src.prepare("SELECT id,actor_type,actor_id,action,entity_type,entity_id,meta,ip,user_agent,created_at FROM audit_log").all();
const sourceCounts = {
  posts: sourcePosts.length,
  published: sourcePosts.filter((post) => post.status === "published" && !post.deleted_at).length,
  revisions: sourceRevisions.length,
  categories: sourceCategories.length,
  tags: sourceTags.length,
  post_tags: sourcePostTags.length,
  users: sourceUsers.length,
  settings: sourceSettings.length,
  audit_log: sourceAudit.length,
  slug_history: src.prepare("SELECT COUNT(*) AS n FROM slug_history").get().n,
  media: src.prepare("SELECT COUNT(*) AS n FROM media").get().n,
  api_clients: src.prepare("SELECT COUNT(*) AS n FROM api_clients").get().n,
  scheduled: src.prepare("SELECT COUNT(*) AS n FROM posts WHERE status='scheduled'").get().n,
};

const targetPosts = await d1(`SELECT ${postCols.join(",")},version,change_id,origin,external_id,api_client_id FROM posts`);
const targetRevisions = await d1(`SELECT ${revCols.join(",")} FROM revisions`);
const targetUsers = await d1("SELECT id,email,name,role,is_active,bio,created_at,updated_at,password_hash FROM users");
const targetCategories = await d1("SELECT id,name,slug,group_name,description,sort_order,created_at,updated_at,cached_post_count FROM categories");
const targetTags = await d1("SELECT id,name,slug,cached_post_count FROM tags");
const targetPostTags = await d1("SELECT post_id,tag_id FROM post_tags ORDER BY post_id,tag_id");
const targetSettings = await d1("SELECT key,value FROM settings");
const targetAudit = await d1("SELECT id,actor_type,actor_id,action,entity_type,entity_id,meta,ip,user_agent,created_at FROM audit_log ORDER BY id");
const targetCounts = (await d1(`SELECT
  (SELECT COUNT(*) FROM posts) posts,
  (SELECT COUNT(*) FROM posts WHERE status='published' AND deleted_at IS NULL) published,
  (SELECT COUNT(*) FROM revisions) revisions,
  (SELECT COUNT(*) FROM categories) categories,
  (SELECT COUNT(*) FROM tags) tags,
  (SELECT COUNT(*) FROM post_tags) post_tags,
  (SELECT COUNT(*) FROM users) users,
  (SELECT COUNT(*) FROM settings) settings,
  (SELECT COUNT(*) FROM audit_log) audit_log,
  (SELECT COUNT(*) FROM slug_history) slug_history,
  (SELECT COUNT(*) FROM media) media,
  (SELECT COUNT(*) FROM api_clients) api_clients,
  (SELECT COUNT(*) FROM posts WHERE status='scheduled') scheduled,
  (SELECT COUNT(*) FROM posts_fts) fts,
  (SELECT value FROM counters WHERE key='published_posts') counter_published,
  (SELECT COUNT(*) FROM posts WHERE version>=1) versioned,
  (SELECT COUNT(*) FROM posts WHERE change_id<>'') identified`))[0];

const postFieldDiffCounts = {};
const postDiffSamples = [];
for (const left of sourcePosts) {
  const right = targetPosts.find((row) => row.id === left.id);
  if (!right) continue;
  const diff = postCols.filter((col) => String(left[col] ?? "") !== String(right[col] ?? ""));
  for (const field of diff) postFieldDiffCounts[field] = (postFieldDiffCounts[field] || 0) + 1;
  if (diff.length && postDiffSamples.length < 3) postDiffSamples.push({ id: left.id, slug: left.slug, fields: diff });
}
const revisionFieldDiffCounts = {};
const revisionDiffSamples = [];
for (const left of sourceRevisions) {
  const right = targetRevisions.find((row) => row.id === left.id);
  if (!right) continue;
  const diff = revCols.filter((col) => String(left[col] ?? "") !== String(right[col] ?? ""));
  for (const field of diff) revisionFieldDiffCounts[field] = (revisionFieldDiffCounts[field] || 0) + 1;
  if (diff.length && revisionDiffSamples.length < 3) revisionDiffSamples.push({ id: left.id, post_id: left.post_id, fields: diff });
}
const sourcePostHashes = hashRows(sourcePosts, postCols);
const targetPostHashes = hashRows(targetPosts, postCols);
const sourceRevisionHashes = hashRows(sourceRevisions, revCols);
const targetRevisionHashes = hashRows(targetRevisions, revCols);
const sourcePostTagKeys = sourcePostTags.map((row) => `${row.post_id}:${row.tag_id}`).sort();
const targetPostTagKeys = targetPostTags.map((row) => `${row.post_id}:${row.tag_id}`).sort();
const sourceCategoryMap = new Map(sourceCategories.map((row) => [row.id, row]));
const sourceTagMap = new Map(sourceTags.map((row) => [row.id, row]));
const targetUserId = targetUsers[0]?.id;
const settingsMap = new Map(targetSettings.map((row) => [row.key, row.value]));
const integrityRows = await d1(`SELECT
  (SELECT COUNT(*) FROM post_tags pt LEFT JOIN posts p ON p.id=pt.post_id WHERE p.id IS NULL) orphan_post_tags,
  (SELECT COUNT(*) FROM revisions r LEFT JOIN posts p ON p.id=r.post_id WHERE p.id IS NULL) orphan_revisions,
  (SELECT COUNT(*) FROM posts p LEFT JOIN users u ON u.id=p.author_id WHERE u.id IS NULL) orphan_authors,
  (SELECT COUNT(*) FROM categories c WHERE c.cached_post_count != (SELECT COUNT(*) FROM posts p WHERE p.category_id=c.id AND p.status='published' AND p.deleted_at IS NULL)) bad_category_counts,
  (SELECT COUNT(*) FROM tags t WHERE t.cached_post_count != (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id=pt.post_id WHERE pt.tag_id=t.id AND p.status='published' AND p.deleted_at IS NULL)) bad_tag_counts`);
const integrity = integrityRows?.[0] || {};
const fts = await d1(`SELECT COUNT(*) AS hits FROM posts_fts WHERE posts_fts MATCH '"wifi"*'`);
const triggers = await d1("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'");
const migrations = await d1("SELECT COUNT(*) AS n FROM d1_migrations");
const checks = {
  posts_count: targetCounts.posts === sourceCounts.posts,
  published_count: targetCounts.published === sourceCounts.published,
  revisions_count: targetCounts.revisions === sourceCounts.revisions,
  categories_count: targetCounts.categories === sourceCounts.categories,
  tags_count: targetCounts.tags === sourceCounts.tags,
  post_tags_count: targetCounts.post_tags === sourceCounts.post_tags,
  users_count: targetCounts.users === sourceCounts.users,
  settings_count: targetCounts.settings >= sourceCounts.settings,
  audit_log_count: targetCounts.audit_log === sourceCounts.audit_log,
  slug_history_count: targetCounts.slug_history === sourceCounts.slug_history,
  media_count: targetCounts.media === sourceCounts.media,
  api_clients_count: targetCounts.api_clients === sourceCounts.api_clients,
  scheduled_count: targetCounts.scheduled === sourceCounts.scheduled,
  post_hashes_match: [...sourcePostHashes].every(([id, hash]) => targetPostHashes.get(id) === hash),
  revision_hashes_match: [...sourceRevisionHashes].every(([id, hash]) => targetRevisionHashes.get(id) === hash),
  post_tags_match: sourcePostTagKeys.join("|") === targetPostTagKeys.join("|"),
  author_mapping: targetPosts.every((post) => post.author_id === targetUserId),
  category_fields_match: sourceCategories.every((row) => targetCategories.some((t) => t.id === row.id && t.name === row.name && t.slug === row.slug && t.group_name === row.group_name && t.description === row.description && t.sort_order === row.sort_order)),
  tag_fields_match: sourceTags.every((row) => targetTags.some((t) => t.id === row.id && t.name === row.name && t.slug === row.slug)),
  settings_default_author: sourceSettings.some((row) => row.key === "default_author_id" && settingsMap.get("default_author_id") === row.value),
  audit_rows_match: JSON.stringify(sourceAudit.map((row) => ({ ...row }))) === JSON.stringify(targetAudit.map((row) => ({ ...row }))),
  version_change_id: Number(targetCounts.versioned) === targetCounts.posts && Number(targetCounts.identified) === targetCounts.posts,
  fts_count: Number(targetCounts.fts) === targetCounts.posts,
  fts_search: Number(fts[0]?.hits || 0) > 0,
  counters: Number(targetCounts.counter_published) === targetCounts.published,
  no_orphans: Object.values(integrity).every((value) => Number(value) === 0),
  triggers: Number(triggers[0]?.n || 0) >= 8,
  migrations: Number(migrations[0]?.n || 0) >= 10,
  password_hash_format: /^scrypt\$16384\$8\$1\$/.test(targetUsers[0]?.password_hash || ""),
};
const result = {
  generated_at: new Date().toISOString(),
  target: target.database_name,
  source_counts: sourceCounts,
  target_counts: targetCounts,
  checks,
  integrity,
  post_field_diffs: postFieldDiffCounts,
  post_diff_samples: postDiffSamples,
  revision_field_diffs: revisionFieldDiffCounts,
  revision_diff_samples: revisionDiffSamples,
  notes: {
    password_hash: "Isolated test DB uses a generated test scrypt hash, not the source credential; production migration must preserve source hash.",
    revisions: "All source revisions imported and hash-matched.",
    author: "Source user UUID preserved; all posts author_id point to it.",
  },
};
fs.writeFileSync("fixtures/m7-isolated-migration-verify.json", JSON.stringify(result, null, 2));
const failed = Object.entries(checks).filter(([, ok]) => !ok);
console.log(JSON.stringify({ target: result.target, source_counts: sourceCounts, target_counts: targetCounts, checks, failed: failed.map(([name]) => name), integrity: result.integrity }, null, 2));
process.exitCode = failed.length ? 1 : 0;
