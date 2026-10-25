import { plainText } from "./text.js";

export const nowIso = () => new Date().toISOString();

const uuid = () => crypto.randomUUID();

export function slugify(input, maxLength = 90) {
  const normalized = String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized.slice(0, maxLength).replace(/-+$/g, "");
}

export async function getPostBySlug(db, slug, { includeDrafts = false } = {}) {
  const row = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
              u.name AS author_name
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.slug = ? AND p.deleted_at IS NULL ${includeDrafts ? "" : "AND p.status = 'published'"}
       LIMIT 1`,
    )
    .bind(slug)
    .first();
  if (!row) return null;
  row.tags = await getTagsForPost(db, row.id);
  return row;
}

export async function getPostById(db, id) {
  const row = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
              u.name AS author_name
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first();
  if (row) row.tags = await getTagsForPost(db, row.id);
  return row;
}

export async function getTagsForPost(db, postId) {
  const result = await db
    .prepare(
      `SELECT t.id, t.name, t.slug FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = ? ORDER BY t.name`,
    )
    .bind(postId)
    .all();
  return result.results || [];
}

export async function listLatest(db, limit = 16) {
  const result = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
              u.name AS author_name
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.status = 'published' AND p.deleted_at IS NULL
       ORDER BY p.published_at DESC, p.id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return result.results || [];
}

export async function listCategories(db) {
  const result = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status='published' AND p.deleted_at IS NULL) AS post_count
       FROM categories c ORDER BY c.sort_order, c.name`,
    )
    .all();
  return result.results || [];
}

export async function listCategoriesFast(db) {
  const result = await db
    .prepare("SELECT c.*, c.cached_post_count AS post_count FROM categories c ORDER BY c.sort_order, c.name")
    .all();
  return result.results || [];
}

export async function listRelated(db, post, limit = 4) {
  if (!post.category_id) {
    const fill = await db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM posts p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.status='published' AND p.deleted_at IS NULL AND p.id <> ?
         ORDER BY p.published_at DESC LIMIT ?`,
      )
      .bind(post.id, limit)
      .all();
    return fill.results || [];
  }
  const same = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM posts p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status='published' AND p.deleted_at IS NULL AND p.id <> ? AND p.category_id = ?
       ORDER BY p.published_at DESC LIMIT ?`,
    )
    .bind(post.id, post.category_id, limit)
    .all();
  const rows = same.results || [];
  if (rows.length >= limit) return rows;
  const ids = new Set([post.id, ...rows.map((row) => row.id)]);
  const fill = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM posts p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status='published' AND p.deleted_at IS NULL AND p.id <> ?
       ORDER BY p.published_at DESC LIMIT ?`,
    )
    .bind(post.id, limit * 4)
    .all();
  for (const row of fill.results || []) {
    if (rows.length >= limit) break;
    if (!ids.has(row.id)) {
      rows.push(row);
      ids.add(row.id);
    }
  }
  return rows;
}

export async function searchPostsFast(db, q, limit = 8) {
  const terms = String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 8);
  if (!terms.length) return [];
  const match = terms.map((term) => `"${term.replace(/"/g, "")}"*`).join(" AND ");
  const result = await db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.excerpt, p.published_at, p.read_minutes,
              c.name AS category_name, c.slug AS category_slug
       FROM posts_fts f
       JOIN posts p ON p.id = f.post_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE posts_fts MATCH ? AND p.status='published' AND p.deleted_at IS NULL
       LIMIT ?`,
    )
    .bind(match, limit)
    .all();
  return result.results || [];
}

export async function searchPostsCapped(db, q, limit = 8, candidates = 200) {
  const terms = String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 8);
  if (!terms.length) return [];
  const match = terms.map((term) => `"${term.replace(/"/g, "")}"*`).join(" AND ");
  const result = await db
    .prepare(
      `SELECT * FROM (
         SELECT p.id, p.slug, p.title, p.excerpt, p.published_at, p.read_minutes,
                c.name AS category_name, c.slug AS category_slug,
                bm25(posts_fts) AS score
         FROM posts_fts
         JOIN posts p ON p.id = posts_fts.post_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE posts_fts MATCH ? AND p.status='published' AND p.deleted_at IS NULL
         LIMIT ?
       ) ORDER BY score, published_at DESC LIMIT ?`,
    )
    .bind(match, candidates, limit)
    .all();
  return result.results || [];
}

export async function searchPosts(db, q, limit = 8) {
  const terms = String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 8);
  if (!terms.length) return [];
  const match = terms.map((term) => `"${term.replace(/"/g, "")}"*`).join(" AND ");
  const result = await db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.excerpt, p.published_at, p.read_minutes,
              c.name AS category_name, c.slug AS category_slug
       FROM posts_fts f
       JOIN posts p ON p.id = f.post_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE posts_fts MATCH ? AND p.status='published' AND p.deleted_at IS NULL
       ORDER BY rank, p.published_at DESC
       LIMIT ?`,
    )
    .bind(match, limit)
    .all();
  return result.results || [];
}

async function ensureTag(db, name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const slug = slugify(clean);
  const existing = await db.prepare("SELECT id FROM tags WHERE name = ? OR slug = ? LIMIT 1").bind(clean, slug).first();
  if (existing) return existing.id;
  const id = uuid();
  await db.prepare("INSERT INTO tags (id,name,slug) VALUES (?,?,?)").bind(id, clean, slug).run();
  return id;
}

export async function createPost(db, data) {
  const id = uuid();
  const now = nowIso();
  const text = plainText(data.content_html);
  const readMinutes = data.readMinutes || Math.max(1, Math.ceil(text.split(/\s+/).length / 200));
  const statements = [
    db
      .prepare(
        `INSERT INTO posts
         (id,slug,title,excerpt,lede,content_html,content_source,content_format,status,category_id,author_id,
          cover_image,cover_alt,cover_caption,seo_title,seo_description,focus_keyword,canonical_url,og_image,
          is_featured,read_minutes,views,published_at,scheduled_at,created_at,updated_at,api_client_id,external_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        data.slug || slugify(data.title),
        data.title,
        data.excerpt || "",
        data.lede || "",
        data.content_html,
        data.content_source || data.content_html,
        data.content_format || "html",
        data.status || "draft",
        data.categoryId || null,
        data.authorId || null,
        data.coverImage || "",
        data.coverAlt || "",
        data.coverCaption || "",
        data.seoTitle || "",
        data.seoDescription || data.excerpt || "",
        data.focusKeyword || "",
        data.canonicalUrl || "",
        data.ogImage || data.coverImage || "",
        data.isFeatured ? 1 : 0,
        readMinutes,
        data.publishedAt || null,
        data.scheduledAt || null,
        now,
        now,
        data.apiClientId || null,
        data.externalId || null,
      ),
    db
      .prepare("INSERT INTO posts_fts (post_id,title,excerpt,content) VALUES (?,?,?,?)")
      .bind(id, data.title, data.excerpt || "", text),
  ];
  const tagIds = [];
  for (const tag of data.tags || []) {
    const tagId = await ensureTag(db, tag);
    if (tagId && !tagIds.includes(tagId)) tagIds.push(tagId);
  }
  for (const tagId of tagIds) {
    statements.push(db.prepare("INSERT INTO post_tags (post_id,tag_id) VALUES (?,?)").bind(id, tagId));
  }
  await db.batch(statements);
  return getPostById(db, id);
}

export async function updatePost(db, id, patch) {
  const existing = await getPostById(db, id);
  if (!existing) return null;
  const fields = [];
  const values = [];
  const allowed = {
    title: "title",
    slug: "slug",
    excerpt: "excerpt",
    lede: "lede",
    content_html: "content_html",
    content_source: "content_source",
    content_format: "content_format",
    status: "status",
    cover_image: "cover_image",
    seo_title: "seo_title",
    seo_description: "seo_description",
    external_id: "external_id",
    published_at: "published_at",
    scheduled_at: "scheduled_at",
    is_featured: "is_featured",
    read_minutes: "read_minutes",
  };
  for (const [key, column] of Object.entries(allowed)) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = ?`);
      values.push(patch[key]);
    }
  }
  if (!fields.length) return existing;
  fields.push("updated_at = ?");
  values.push(nowIso());
  const statements = [
    db.prepare(`UPDATE posts SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id),
    db.prepare("DELETE FROM posts_fts WHERE post_id = ?").bind(id),
    db
      .prepare("INSERT INTO posts_fts (post_id,title,excerpt,content) VALUES (?,?,?,?)")
      .bind(
        id,
        patch.title ?? existing.title,
        patch.excerpt ?? existing.excerpt,
        plainText(patch.content_html ?? existing.content_html),
      ),
  ];
  await db.batch(statements);
  return getPostById(db, id);
}

export async function publishDue(db, now = nowIso(), limit = 20) {
  const due = await db
    .prepare(
      "SELECT id, slug, scheduled_at FROM posts WHERE status='scheduled' AND deleted_at IS NULL AND scheduled_at <= ? ORDER BY scheduled_at LIMIT ?",
    )
    .bind(now, limit)
    .all();
  const rows = due.results || [];
  if (!rows.length) return { selected: 0, published: [] };
  const statements = rows.map((row) =>
    db
      .prepare(
        "UPDATE posts SET status='published', published_at=?, scheduled_at=NULL, updated_at=?, version=version+1, change_id=? WHERE id=? AND status='scheduled'",
      )
      .bind(row.scheduled_at, nowIso(), crypto.randomUUID(), row.id),
  );
  const results = await db.batch(statements);
  const published = [];
  results.forEach((result, index) => {
    if ((result.meta?.changes || 0) > 0) published.push(rows[index].slug);
  });
  return { selected: rows.length, published };
}

export async function verifyApiKey(db, rawKey) {
  const match = /^mh_([a-f0-9]{10})_([A-Za-z0-9_-]{20,})$/.exec(String(rawKey || "").trim());
  if (!match) return null;
  const [, keyId, secret] = match;
  const client = await db
    .prepare("SELECT * FROM api_clients WHERE key_id = ? AND is_active = 1 LIMIT 1")
    .bind(keyId)
    .first();
  if (!client) return null;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
  );
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== client.key_hash) return null;
  client.scopes = JSON.parse(client.scopes || "[]");
  return client;
}

export async function getIdempotent(db, clientId, key, method, path) {
  return db
    .prepare("SELECT * FROM idempotency_keys WHERE client_id=? AND idem_key=? AND method=? AND path=? LIMIT 1")
    .bind(clientId, key, method, path)
    .first();
}

export async function saveIdempotent(db, clientId, key, method, path, requestHash, statusCode, body) {
  await db
    .prepare(
      "INSERT OR REPLACE INTO idempotency_keys (client_id,idem_key,method,path,request_hash,status_code,response_body,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind(clientId, key, method, path, requestHash, statusCode, body, nowIso())
    .run();
}

export async function createSession(db, userId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const csrf = crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await db
    .prepare("INSERT INTO sessions (id,user_id,csrf_token,created_at,expires_at) VALUES (?,?,?,?,?)")
    .bind(tokenHash, userId, csrf, new Date(now).toISOString(), new Date(now + 8 * 3600_000).toISOString())
    .run();
  return { token, csrf };
}

export async function readSession(db, token) {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      "SELECT s.*, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at > ? LIMIT 1",
    )
    .bind(tokenHash, nowIso())
    .first();
  return row || null;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function dbStats(db) {
  const posts = await db.prepare("SELECT COUNT(*) AS n FROM posts").first();
  const fts = await db.prepare("SELECT COUNT(*) AS n FROM posts_fts").first();
  return { posts: posts?.n || 0, fts: fts?.n || 0 };
}
