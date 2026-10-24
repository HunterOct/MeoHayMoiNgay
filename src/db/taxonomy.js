import crypto from "node:crypto";
import { getDb } from "./index.js";
import { nowIso } from "../lib/time.js";
import { slugify, uniqueSlug } from "../lib/slug.js";

export function listCategories({ withCounts = false } = {}) {
  const db = getDb();
  if (!withCounts) {
    return db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, name ASC").all();
  }
  return db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM posts p
                WHERE p.category_id = c.id AND p.status = 'published' AND p.deleted_at IS NULL) AS post_count
       FROM categories c
       ORDER BY c.sort_order ASC, c.name ASC`,
    )
    .all();
}

export function getCategoryBySlug(slug) {
  return getDb().prepare("SELECT * FROM categories WHERE slug = ?").get(slug) || null;
}

export function getCategoryById(id) {
  return getDb().prepare("SELECT * FROM categories WHERE id = ?").get(id) || null;
}

function categorySlugTaken(slug, excludeId = null) {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM categories WHERE slug = ? AND (? IS NULL OR id <> ?)")
    .get(slug, excludeId, excludeId);
  return Boolean(row);
}

export function createCategory({ name, slug, group = "life", description = "", sortOrder = 0 }) {
  const db = getDb();
  const now = nowIso();
  const id = crypto.randomUUID();
  const finalSlug = uniqueSlug(slug || name, (s) => categorySlugTaken(s));
  db.prepare(
    `INSERT INTO categories (id, name, slug, group_name, description, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name.trim(), finalSlug, group, description, sortOrder, now, now);
  return getCategoryById(id);
}

export function updateCategory(id, patch) {
  const db = getDb();
  const existing = getCategoryById(id);
  if (!existing) return null;
  const fields = {
    name: patch.name ?? existing.name,
    group: patch.group ?? existing.group_name,
    description: patch.description ?? existing.description,
    sort_order: patch.sortOrder ?? existing.sort_order,
    slug: existing.slug,
  };
  if (patch.slug && slugify(patch.slug) !== existing.slug) {
    if (categorySlugTaken(slugify(patch.slug), id)) {
      const err = new Error("Slug chuyên mục đã tồn tại");
      err.code = "SLUG_TAKEN";
      throw err;
    }
    fields.slug = slugify(patch.slug);
  }
  db.prepare(
    `UPDATE categories SET name = ?, slug = ?, group_name = ?, description = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(fields.name.trim(), fields.slug, fields.group, fields.description, fields.sort_order, nowIso(), id);
  return getCategoryById(id);
}

export function deleteCategory(id, { reassignTo = null } = {}) {
  const db = getDb();
  const used = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE category_id = ?").get(id).n;
  if (used > 0 && !reassignTo) {
    const err = new Error("Chuyên mục đang được sử dụng");
    err.code = "CATEGORY_IN_USE";
    err.count = used;
    throw err;
  }
  return db.transaction(() => {
    if (used > 0) {
      db.prepare("UPDATE posts SET category_id = ?, updated_at = ? WHERE category_id = ?").run(
        reassignTo,
        nowIso(),
        id,
      );
    }
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  })();
}

export function listTags({ withCounts = false } = {}) {
  const db = getDb();
  if (!withCounts) return db.prepare("SELECT * FROM tags ORDER BY name ASC").all();
  return db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM post_tags pt
                 JOIN posts p ON p.id = pt.post_id
                WHERE pt.tag_id = t.id AND p.status = 'published' AND p.deleted_at IS NULL) AS post_count
       FROM tags t ORDER BY t.name ASC`,
    )
    .all();
}

export function getTagBySlug(slug) {
  return getDb().prepare("SELECT * FROM tags WHERE slug = ?").get(slug) || null;
}

function tagSlugTaken(slug, excludeId = null) {
  return Boolean(
    getDb()
      .prepare("SELECT id FROM tags WHERE slug = ? AND (? IS NULL OR id <> ?)")
      .get(slug, excludeId, excludeId),
  );
}

export function findOrCreateTag(name) {
  const db = getDb();
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const existing = db.prepare("SELECT * FROM tags WHERE name = ? COLLATE NOCASE OR slug = ?").get(clean, slugify(clean));
  if (existing) return existing;
  const id = crypto.randomUUID();
  const slug = uniqueSlug(clean, (s) => tagSlugTaken(s));
  db.prepare("INSERT INTO tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)").run(id, clean, slug, nowIso());
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
}

export function ensureTags(names) {
  const list = [];
  for (const name of names || []) {
    const tag = findOrCreateTag(name);
    if (tag && !list.some((t) => t.id === tag.id)) list.push(tag);
  }
  return list;
}

export function updateTag(id, { name, slug }) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  if (!existing) return null;
  const finalSlug = slug && slugify(slug) !== existing.slug ? slugify(slug) : existing.slug;
  if (finalSlug !== existing.slug && tagSlugTaken(finalSlug, id)) {
    const err = new Error("Slug thẻ đã tồn tại");
    err.code = "SLUG_TAKEN";
    throw err;
  }
  db.prepare("UPDATE tags SET name = ?, slug = ? WHERE id = ?").run(
    (name || existing.name).trim(),
    finalSlug,
    id,
  );
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
}

export function deleteTag(id) {
  getDb().prepare("DELETE FROM tags WHERE id = ?").run(id);
}
