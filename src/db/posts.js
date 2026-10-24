import crypto from "node:crypto";
import { getDb } from "./index.js";
import { nowIso, readingMinutes } from "../lib/time.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { plainText, toHtml } from "../lib/sanitize.js";
import { ensureTags } from "./taxonomy.js";

const BASE_SELECT = `
  SELECT p.*,
         c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
         u.name AS author_name, u.bio AS author_bio
  FROM posts p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN users u ON u.id = p.author_id
`;

function slugTaken(slug, excludeId = null) {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM posts WHERE slug = ? AND (? IS NULL OR id <> ?)
         UNION ALL
         SELECT 1 FROM slug_history WHERE slug = ? AND (? IS NULL OR post_id <> ?)
         LIMIT 1`,
      )
      .get(slug, excludeId, excludeId, slug, excludeId, excludeId),
  );
}

export function buildSlug(input, { excludeId = null, fallback = "bai-viet" } = {}) {
  return uniqueSlug(slugify(input || fallback) || fallback, (s) => slugTaken(s, excludeId));
}

export function tagsFor(postId) {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = ? ORDER BY t.name ASC`,
    )
    .all(postId);
}

export function withTags(post) {
  if (!post) return null;
  return { ...post, tags: tagsFor(post.id) };
}

export function getById(id, { includeDeleted = true } = {}) {
  const sql = `${BASE_SELECT} WHERE p.id = ?${includeDeleted ? "" : " AND p.deleted_at IS NULL"}`;
  return getDb().prepare(sql).get(id) || null;
}

export function findByExternalId(clientId, externalId) {
  return (
    getDb()
      .prepare(`${BASE_SELECT} WHERE p.api_client_id = ? AND p.external_id = ?`)
      .get(clientId, externalId) || null
  );
}

export function getPublishedBySlug(slug) {
  return (
    getDb()
      .prepare(
        `${BASE_SELECT} WHERE p.slug = ? AND p.status = 'published' AND p.deleted_at IS NULL`,
      )
      .get(slug) || null
  );
}

export function getAnyBySlug(slug) {
  return getDb().prepare(`${BASE_SELECT} WHERE p.slug = ? AND p.deleted_at IS NULL`).get(slug) || null;
}

export function getTrashedBySlug(slug) {
  return (
    getDb()
      .prepare(`${BASE_SELECT} WHERE p.slug = ? AND p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`)
      .get(slug) || null
  );
}

export function findHistoricalSlug(slug) {
  const row = getDb()
    .prepare(
      `SELECT p.slug AS current_slug, p.deleted_at FROM slug_history h
       JOIN posts p ON p.id = h.post_id WHERE h.slug = ? LIMIT 1`,
    )
    .get(slug);
  return row || null;
}

function ftsUpsert(post) {
  const db = getDb();
  db.prepare("DELETE FROM posts_fts WHERE post_id = ?").run(post.id);
  db.prepare(
    "INSERT INTO posts_fts (post_id, title, excerpt, content) VALUES (?, ?, ?, ?)",
  ).run(post.id, post.title || "", post.excerpt || "", plainText(post.content_html || ""));
}

function ftsRemove(id) {
  getDb().prepare("DELETE FROM posts_fts WHERE post_id = ?").run(id);
}

function syncMediaUsage(postId, contentHtml, coverImage) {
  const db = getDb();
  const haystack = `${contentHtml || ""} ${coverImage || ""}`;
  const filenames = new Set();
  for (const match of haystack.matchAll(/\/media\/([A-Za-z0-9._-]+)/g)) filenames.add(match[1]);
  db.prepare("DELETE FROM media_usages WHERE post_id = ?").run(postId);
  if (!filenames.size) return;
  const find = db.prepare("SELECT id FROM media WHERE filename = ?");
  const insert = db.prepare("INSERT OR IGNORE INTO media_usages (media_id, post_id) VALUES (?, ?)");
  for (const name of filenames) {
    const media = find.get(name);
    if (media) insert.run(media.id, postId);
  }
}

function setPostTags(postId, names) {
  const db = getDb();
  db.prepare("DELETE FROM post_tags WHERE post_id = ?").run(postId);
  if (!names || !names.length) return;
  const tags = ensureTags(names);
  const insert = db.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)");
  for (const tag of tags) insert.run(postId, tag.id);
}

export function setTagsFor(postId, names) {
  setPostTags(postId, names);
  return tagsFor(postId);
}

function saveRevision(post, { editedByType = "user", editedById = null } = {}) {
  getDb()
    .prepare(
      `INSERT INTO revisions
        (id, post_id, title, excerpt, content_html, content_source, content_format, seo_title, seo_description,
         cover_image, status, edited_by_type, edited_by_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      post.id,
      post.title,
      post.excerpt,
      post.content_html,
      post.content_source,
      post.content_format,
      post.seo_title,
      post.seo_description,
      post.cover_image,
      post.status,
      editedByType,
      editedById,
      nowIso(),
    );
}

function normalizeStatusDates(status, { publishedAt, scheduledAt, existing = {} }) {
  let pub = publishedAt ?? existing.published_at ?? null;
  let sched = scheduledAt ?? existing.scheduled_at ?? null;
  if (status === "published") {
    pub = pub || nowIso();
    sched = null;
  } else if (status === "scheduled") {
    if (!sched) throw new Error("SCHEDULED_AT_REQUIRED");
    pub = null;
  } else if (status === "draft" || status === "review") {
    sched = null;
  }
  return { publishedAt: pub, scheduledAt: sched };
}

export function createPost(data, { actorType = "user", actorId = null } = {}) {
  const db = getDb();
  const now = nowIso();
  const id = crypto.randomUUID();
  const slug = buildSlug(data.slug || data.title);
  const contentFormat = data.contentFormat || "html";
  const contentSource =
    data.contentSource !== undefined ? data.contentSource : data.contentHtml || "";
  const contentHtml = data.contentHtml || toHtml(contentSource, contentFormat);
  const readMinutes = data.readMinutes || readingMinutes(contentHtml);
  const dates = normalizeStatusDates(data.status || "draft", {
    publishedAt: data.publishedAt,
    scheduledAt: data.scheduledAt,
  });

  db.transaction(() => {
    db.prepare(
      `INSERT INTO posts
        (id, slug, title, excerpt, lede, content_html, content_source, content_format, status, category_id, author_id,
         cover_image, cover_alt, cover_caption, seo_title, seo_description, focus_keyword, canonical_url,
         og_image, is_featured, read_minutes, published_at, scheduled_at, created_at, updated_at, origin, api_client_id, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, slug, data.title.trim(), data.excerpt || "", data.lede || "", contentHtml, contentSource,
      contentFormat, data.status || "draft", data.categoryId || null,
      data.authorId || null, data.coverImage || "", data.coverAlt || "", data.coverCaption || "",
      data.seoTitle || "", data.seoDescription || "", data.focusKeyword || "",
      data.canonicalUrl || "", data.ogImage || data.coverImage || "", data.isFeatured ? 1 : 0,
      readMinutes, dates.publishedAt, dates.scheduledAt, now, now,
      data.origin || actorType, data.apiClientId || null, data.externalId || null,
    );
    setPostTags(id, data.tags || []);
    syncMediaUsage(id, contentHtml, data.coverImage);
    const post = getById(id);
    saveRevision(post, { editedByType: actorType, editedById: actorId });
    ftsUpsert(post);
  })();

  return withTags(getById(id));
}

const UPDATABLE = {
  title: "title",
  excerpt: "excerpt",
  lede: "lede",
  contentHtml: "content_html",
  contentSource: "content_source",
  contentFormat: "content_format",
  status: "status",
  categoryId: "category_id",
  authorId: "author_id",
  coverImage: "cover_image",
  coverAlt: "cover_alt",
  coverCaption: "cover_caption",
  seoTitle: "seo_title",
  seoDescription: "seo_description",
  focusKeyword: "focus_keyword",
  canonicalUrl: "canonical_url",
  ogImage: "og_image",
  isFeatured: "is_featured",
  readMinutes: "read_minutes",
  publishedAt: "published_at",
  scheduledAt: "scheduled_at",
};

export function updatePost(id, patch, { actorType = "user", actorId = null, revision = true } = {}) {
  const db = getDb();
  const existing = getById(id);
  if (!existing) return null;

  const next = { ...existing };
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (patch[key] !== undefined) next[column] = patch[key];
  }
  if (patch.isFeatured !== undefined) next.is_featured = patch.isFeatured ? 1 : 0;
  if (patch.contentSource !== undefined) next.content_source = patch.contentSource;
  if (patch.contentHtml !== undefined && patch.contentSource === undefined) {
    next.content_html = patch.contentHtml;
  } else if (patch.contentSource !== undefined || patch.contentFormat !== undefined) {
    next.content_html = toHtml(next.content_source, next.content_format);
  }
  if (patch.readMinutes !== undefined) {
    next.read_minutes = Math.max(1, Number(patch.readMinutes) || 1);
  } else if (patch.contentSource !== undefined || patch.contentHtml !== undefined) {
    next.read_minutes = readingMinutes(next.content_html);
  }
  if (patch.ogImage === undefined && patch.coverImage !== undefined && !existing.og_image) {
    next.og_image = patch.coverImage;
  }

  let newSlug = existing.slug;
  if (patch.slug !== undefined && patch.slug !== "" && slugify(patch.slug) !== existing.slug) {
    newSlug = buildSlug(patch.slug, { excludeId: id });
  }

  const status = next.status;
  const dates = normalizeStatusDates(status, {
    publishedAt: next.published_at,
    scheduledAt: next.scheduled_at,
    existing,
  });

  db.transaction(() => {
    if (revision) saveRevision(existing, { editedByType: actorType, editedById: actorId });
    if (newSlug !== existing.slug) {
      db.prepare("INSERT OR IGNORE INTO slug_history (post_id, slug, created_at) VALUES (?, ?, ?)").run(
        id,
        existing.slug,
        nowIso(),
      );
    }
    db.prepare(
      `UPDATE posts SET
        slug = ?, title = ?, excerpt = ?, lede = ?, content_html = ?, content_source = ?, content_format = ?, status = ?,
        category_id = ?, author_id = ?, cover_image = ?, cover_alt = ?, cover_caption = ?,
        seo_title = ?, seo_description = ?, focus_keyword = ?, canonical_url = ?, og_image = ?,
        is_featured = ?, read_minutes = ?, published_at = ?, scheduled_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      newSlug, next.title, next.excerpt, next.lede, next.content_html, next.content_source,
      next.content_format, status,
      next.category_id, next.author_id, next.cover_image, next.cover_alt, next.cover_caption,
      next.seo_title, next.seo_description, next.focus_keyword, next.canonical_url, next.og_image,
      next.is_featured ? 1 : 0, next.read_minutes, dates.publishedAt, dates.scheduledAt, nowIso(), id,
    );
    if (patch.tags !== undefined) setPostTags(id, patch.tags || []);
    syncMediaUsage(id, next.content_html, next.cover_image);
    ftsUpsert(getById(id));
  })();

  return withTags(getById(id));
}

export function setStatus(id, status, { actorType = "user", actorId = null, scheduledAt, publishedAt } = {}) {
  const existing = getById(id);
  if (!existing) return null;
  const patch = { status };
  if (scheduledAt !== undefined) patch.scheduledAt = scheduledAt;
  if (publishedAt !== undefined) patch.publishedAt = publishedAt;
  if (status === "scheduled" && !scheduledAt) throw new Error("SCHEDULED_AT_REQUIRED");
  return updatePost(id, patch, { actorType, actorId });
}

export function softDelete(id) {
  getDb().prepare("UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  return getById(id);
}

export function restore(id) {
  getDb().prepare("UPDATE posts SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id);
  return getById(id);
}

export function purge(id) {
  getDb().transaction(() => {
    ftsRemove(id);
    getDb().prepare("DELETE FROM posts WHERE id = ?").run(id);
  })();
}

export function incrementViews(id) {
  getDb().prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run(id);
}

export function publishDue(now = nowIso()) {
  const db = getDb();
  const due = db
    .prepare(
      "SELECT id, scheduled_at FROM posts WHERE status = 'scheduled' AND deleted_at IS NULL AND scheduled_at <= ?",
    )
    .all(now);
  if (!due.length) return [];
  const stmt = db.prepare(
    "UPDATE posts SET status = 'published', published_at = ?, scheduled_at = NULL, updated_at = ? WHERE id = ?",
  );
  db.transaction(() => {
    for (const post of due) stmt.run(post.scheduled_at, nowIso(), post.id);
  })();
  return due.map((p) => p.id);
}

function ftsQuery(q) {
  const terms = String(q)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" AND ");
}

export function listPublished({
  categorySlug = null,
  groupSlug = null,
  tagSlug = null,
  q = "",
  page = 1,
  perPage = 8,
  excludeId = null,
  featuredOnly = false,
} = {}) {
  const db = getDb();
  const safePerPage = Math.min(50, Math.max(1, Number(perPage) || 8));
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safePerPage;

  const clauses = ["p.status = 'published'", "p.deleted_at IS NULL"];
  const params = [];
  const joins = [];
  if (categorySlug) {
    clauses.push("c.slug = ?");
    params.push(categorySlug);
  }
  if (groupSlug) {
    clauses.push("c.group_name = ?");
    params.push(groupSlug);
  }
  if (tagSlug) {
    joins.push(
      "JOIN post_tags pt_filter ON pt_filter.post_id = p.id JOIN tags t_filter ON t_filter.id = pt_filter.tag_id",
    );
    clauses.push("t_filter.slug = ?");
    params.push(tagSlug);
  }
  if (excludeId) {
    clauses.push("p.id <> ?");
    params.push(excludeId);
  }
  if (featuredOnly) clauses.push("p.is_featured = 1");
  let order = "p.published_at DESC, p.id DESC";
  if (q && q.trim()) {
    const match = ftsQuery(q);
    if (match) {
      joins.push("JOIN posts_fts ON posts_fts.post_id = p.id");
      clauses.push("posts_fts MATCH ?");
      params.push(match);
      order = "rank, p.published_at DESC";
    } else {
      clauses.push("(p.title LIKE ? OR p.excerpt LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
  }
  const whereSql = `WHERE ${clauses.join(" AND ")}`;
  const joinSql = joins.join(" ");

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id ${joinSql} ${whereSql}`,
    )
    .get(...params).n;

  const items = db
    .prepare(`${BASE_SELECT} ${joinSql} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, safePerPage, offset);

  return {
    items,
    total,
    page: safePage,
    perPage: safePerPage,
    totalPages: Math.max(1, Math.ceil(total / safePerPage)),
  };
}

export function listLatest(limit = 8, { categorySlug = null } = {}) {
  const { items } = listPublished({ perPage: limit, categorySlug });
  return items;
}

export function listPopular(limit = 5) {
  return getDb()
    .prepare(
      `${BASE_SELECT} WHERE p.status = 'published' AND p.deleted_at IS NULL
       ORDER BY p.views DESC, p.published_at DESC LIMIT ?`,
    )
    .all(limit);
}

export function listSitemap() {
  return getDb()
    .prepare(
      `SELECT slug, cover_image, updated_at, published_at FROM posts
       WHERE status = 'published' AND deleted_at IS NULL
       ORDER BY published_at DESC`,
    )
    .all();
}

export function listRelated(post, limit = 4) {
  const db = getDb();
  const sameCategory = db
    .prepare(
      `${BASE_SELECT} WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.id <> ?
       AND (? IS NULL OR p.category_id = ?)
       ORDER BY p.published_at DESC LIMIT ?`,
    )
    .all(post.id, post.category_id, post.category_id, limit);
  if (sameCategory.length >= limit) return sameCategory;
  const ids = new Set([post.id, ...sameCategory.map((p) => p.id)]);
  const fill = db
    .prepare(
      `${BASE_SELECT} WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.id <> ?
       ORDER BY p.published_at DESC LIMIT ?`,
    )
    .all(post.id, limit * 3);
  for (const item of fill) {
    if (sameCategory.length >= limit) break;
    if (!ids.has(item.id)) {
      sameCategory.push(item);
      ids.add(item.id);
    }
  }
  return sameCategory;
}

export function adjacentPosts(post) {
  const db = getDb();
  const prev = db
    .prepare(
      `${BASE_SELECT} WHERE p.status = 'published' AND p.deleted_at IS NULL
       AND (p.published_at > ? OR (p.published_at = ? AND p.id > ?))
       ORDER BY p.published_at ASC, p.id ASC LIMIT 1`,
    )
    .get(post.published_at, post.published_at, post.id);
  const next = db
    .prepare(
      `${BASE_SELECT} WHERE p.status = 'published' AND p.deleted_at IS NULL
       AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))
       ORDER BY p.published_at DESC, p.id DESC LIMIT 1`,
    )
    .get(post.published_at, post.published_at, post.id);
  return { prev: prev || null, next: next || null };
}

export function listAdmin({
  status = "",
  q = "",
  categoryId = "",
  authorId = "",
  deleted = false,
  page = 1,
  perPage = 20,
  offset = null,
} = {}) {
  const db = getDb();
  const clauses = [deleted ? "p.deleted_at IS NOT NULL" : "p.deleted_at IS NULL"];
  const params = [];
  if (status) {
    clauses.push("p.status = ?");
    params.push(status);
  }
  if (categoryId) {
    clauses.push("p.category_id = ?");
    params.push(categoryId);
  }
  if (authorId) {
    clauses.push("p.author_id = ?");
    params.push(authorId);
  }
  if (q) {
    clauses.push("(p.title LIKE ? OR p.slug LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const safePerPage = Math.min(100, Math.max(1, Number(perPage) || 20));
  const safePage = Math.max(1, Number(page) || 1);
  const safeOffset =
    offset === null || offset === undefined
      ? (safePage - 1) * safePerPage
      : Math.max(0, Number(offset) || 0);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM posts p ${where}`)
    .get(...params).n;
  const items = db
    .prepare(`${BASE_SELECT} ${where} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, safePerPage, safeOffset);
  return {
    items,
    total,
    page: safePage,
    perPage: safePerPage,
    offset: safeOffset,
    totalPages: Math.max(1, Math.ceil(total / safePerPage)),
  };
}

export function countByStatus() {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS n FROM posts WHERE deleted_at IS NULL GROUP BY status`,
    )
    .all();
  const counts = { draft: 0, review: 0, scheduled: 0, published: 0, archived: 0, trash: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] = row.n;
    counts.total += row.n;
  }
  counts.trash = getDb().prepare("SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NOT NULL").get().n;
  counts.posts = counts.total;
  return counts;
}

export function countByStatusForAuthor(authorId) {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT status, COUNT(*) AS n FROM posts WHERE author_id = ? AND deleted_at IS NULL GROUP BY status",
    )
    .all(authorId);
  const counts = { draft: 0, review: 0, scheduled: 0, published: 0, archived: 0, trash: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] = row.n;
    counts.total += row.n;
  }
  counts.trash = db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND deleted_at IS NOT NULL")
    .get(authorId).n;
  counts.posts = counts.total;
  return counts;
}

export function listRevisions(postId, limit = 30) {
  return getDb()
    .prepare("SELECT * FROM revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(postId, limit);
}

export function getRevision(id) {
  return getDb().prepare("SELECT * FROM revisions WHERE id = ?").get(id) || null;
}

export function listUpcoming(limit = 5, { authorId = null } = {}) {
  const db = getDb();
  if (authorId) {
    return db
      .prepare(
        `${BASE_SELECT} WHERE p.status = 'scheduled' AND p.deleted_at IS NULL AND p.author_id = ?
         ORDER BY p.scheduled_at ASC LIMIT ?`,
      )
      .all(authorId, limit);
  }
  return db
    .prepare(
      `${BASE_SELECT} WHERE p.status = 'scheduled' AND p.deleted_at IS NULL
       ORDER BY p.scheduled_at ASC LIMIT ?`,
    )
    .all(limit);
}

export function bulkSetStatus(ids, status, actor = {}) {
  if (status === "scheduled") {
    throw new Error("SCHEDULE_REQUIRES_ONE_POST");
  }
  const results = [];
  for (const id of ids) {
    const post = setStatus(id, status, actor);
    if (post) results.push(post);
  }
  return results;
}

export function syncAllFts() {
  const db = getDb();
  const posts = db.prepare("SELECT * FROM posts").all();
  db.transaction(() => {
    db.prepare("DELETE FROM posts_fts").run();
    for (const post of posts) ftsUpsert(post);
  })();
  return posts.length;
}
