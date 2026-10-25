import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.wrangler", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const config = JSON.parse(fs.readFileSync("wrangler.m5.jsonc", "utf8"));
const byBinding = Object.fromEntries(config.d1_databases.map((db) => [db.binding, db]));
const SOURCE = byBinding.M5_SRC;
const TARGET = byBinding.M5_RESTORE;

async function query(db, sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${db.database_id}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(JSON.stringify(payload.errors || payload));
  return payload.result?.[0]?.results || [];
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const sourceSnapshot = await query(SOURCE, `SELECT
  (SELECT COUNT(*) FROM posts) AS posts,
  (SELECT COUNT(*) FROM posts WHERE status='published' AND deleted_at IS NULL) AS published,
  (SELECT COUNT(*) FROM revisions) AS revisions,
  (SELECT COUNT(*) FROM categories) AS categories,
  (SELECT COUNT(*) FROM tags) AS tags,
  (SELECT COUNT(*) FROM post_tags) AS post_tags,
  (SELECT COUNT(*) FROM slug_history) AS slug_history,
  (SELECT COUNT(*) FROM media) AS media,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM audit_log) AS audit_log,
  (SELECT COUNT(*) FROM sessions) AS sessions,
  (SELECT COALESCE(SUM(LENGTH(content_html)),0) FROM posts) AS html_bytes,
  (SELECT COALESCE(SUM(LENGTH(COALESCE(content_source,''))),0) FROM posts) AS source_bytes,
  (SELECT COALESCE(SUM(LENGTH(title)),0) FROM posts) AS title_bytes,
  (SELECT COUNT(*) FROM posts_fts) AS fts_rows,
  (SELECT value FROM counters WHERE key='published_posts') AS counter_published`);
const targetSnapshot = await query(TARGET, `SELECT
  (SELECT COUNT(*) FROM posts) AS posts,
  (SELECT COUNT(*) FROM posts WHERE status='published' AND deleted_at IS NULL) AS published,
  (SELECT COUNT(*) FROM revisions) AS revisions,
  (SELECT COUNT(*) FROM categories) AS categories,
  (SELECT COUNT(*) FROM tags) AS tags,
  (SELECT COUNT(*) FROM post_tags) AS post_tags,
  (SELECT COUNT(*) FROM slug_history) AS slug_history,
  (SELECT COUNT(*) FROM media) AS media,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM audit_log) AS audit_log,
  (SELECT COUNT(*) FROM sessions) AS sessions,
  (SELECT COALESCE(SUM(LENGTH(content_html)),0) FROM posts) AS html_bytes,
  (SELECT COALESCE(SUM(LENGTH(COALESCE(content_source,''))),0) FROM posts) AS source_bytes,
  (SELECT COALESCE(SUM(LENGTH(title)),0) FROM posts) AS title_bytes,
  (SELECT COUNT(*) FROM posts_fts) AS fts_rows,
  (SELECT value FROM counters WHERE key='published_posts') AS counter_published`);

const sourceRow = sourceSnapshot[0];
const targetRow = targetSnapshot[0];
for (const key of Object.keys(sourceRow)) {
  check(`restore.${key}`, String(sourceRow[key]) === String(targetRow[key]), `source=${sourceRow[key]} target=${targetRow[key]}`);
}

const fts = await query(TARGET, `SELECT COUNT(*) AS hits FROM posts_fts WHERE posts_fts MATCH '"wifi"*'`);
check("FTS search after rebuild", Number(fts[0]?.hits || 0) > 0, `hits=${fts[0]?.hits}`);

const integrity = await query(TARGET, `SELECT
  (SELECT COUNT(*) FROM post_tags pt LEFT JOIN posts p ON p.id=pt.post_id WHERE p.id IS NULL) AS orphan_post_tags,
  (SELECT COUNT(*) FROM revisions r LEFT JOIN posts p ON p.id=r.post_id WHERE p.id IS NULL) AS orphan_revisions,
  (SELECT COUNT(*) FROM slug_history s LEFT JOIN posts p ON p.id=s.post_id WHERE p.id IS NULL) AS orphan_slugs,
  (SELECT COUNT(*) FROM categories c WHERE c.cached_post_count != (SELECT COUNT(*) FROM posts p WHERE p.category_id=c.id AND p.status='published' AND p.deleted_at IS NULL)) AS bad_category_counts,
  (SELECT COUNT(*) FROM tags t WHERE t.cached_post_count != (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id=pt.post_id WHERE pt.tag_id=t.id AND p.status='published' AND p.deleted_at IS NULL)) AS bad_tag_counts`);
const integrityRow = integrity[0];
for (const [key, value] of Object.entries(integrityRow)) check(`integrity.${key}=0`, Number(value) === 0, `${value} row(s)`);

const triggers = await query(TARGET, `SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`);
check("restore triggers", triggers.length >= 8, `${triggers.length} triggers`);

const migrations = await query(TARGET, "SELECT COUNT(*) AS count FROM d1_migrations");
check("restore migrations", Number(migrations[0]?.count || 0) >= 10, `${migrations[0]?.count} migrations`);

const failed = results.filter((item) => !item.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exitCode = failed ? 1 : 0;
