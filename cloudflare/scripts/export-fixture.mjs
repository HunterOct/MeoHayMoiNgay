import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const mainDb = "D:/Github/MeoHayMoiNgay/data/blog.db";
const outDir = path.resolve("fixtures");
fs.mkdirSync(outDir, { recursive: true });

const db = new DatabaseSync(mainDb, { readOnly: true });
const posts = db
  .prepare(
    `SELECT p.id, p.slug, p.title, p.excerpt, p.lede, p.content_html, p.content_source,
            p.content_format, p.status, p.cover_image, p.cover_alt, p.cover_caption,
            p.seo_title, p.seo_description, p.focus_keyword, p.canonical_url, p.og_image,
            p.is_featured, p.read_minutes, p.views, p.published_at, p.scheduled_at,
            p.created_at, p.updated_at, p.author_id,
            c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
            u.name AS author_name
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.status = 'published' AND p.deleted_at IS NULL
     ORDER BY p.published_at DESC`,
  )
  .all();

const tagStmt = db.prepare(
  `SELECT t.name, t.slug FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name`,
);
for (const post of posts) {
  post.tags = tagStmt.all(post.id);
}

const categories = db
  .prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status='published' AND p.deleted_at IS NULL) AS post_count
     FROM categories c ORDER BY c.sort_order, c.name`,
  )
  .all();

const tags = db
  .prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id=pt.post_id WHERE pt.tag_id=t.id AND p.status='published' AND p.deleted_at IS NULL) AS post_count
     FROM tags t ORDER BY t.name`,
  )
  .all();

const integrity = db.prepare("PRAGMA integrity_check").get();
const payload = {
  generated_at: new Date().toISOString(),
  source: mainDb,
  integrity,
  counts: {
    posts: posts.length,
    categories: categories.length,
    tags: tags.length,
  },
  categories,
  tags,
  posts,
};
fs.writeFileSync(path.join(outDir, "articles.json"), JSON.stringify(payload, null, 2));
console.log(
  JSON.stringify({
    integrity,
    posts: posts.length,
    categories: categories.length,
    tags: tags.length,
    bytes: fs.statSync(path.join(outDir, "articles.json")).size,
    first: posts[0] && { slug: posts[0].slug, title: posts[0].title, htmlBytes: posts[0].content_html.length },
  }),
);
db.close();
