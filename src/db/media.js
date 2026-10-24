import crypto from "node:crypto";
import { getDb } from "./index.js";
import { nowIso } from "../lib/time.js";

export const mediaUrl = (filename) => `/media/${filename}`;

export function createMedia({ filename, originalName, mime, size, width, height, alt = "", uploadedBy = null }) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO media (id, filename, original_name, mime, size, width, height, alt, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, filename, originalName, mime, size, width || null, height || null, alt, uploadedBy, nowIso());
  return getMedia(id);
}

export function getMedia(id) {
  return getDb().prepare("SELECT * FROM media WHERE id = ?").get(id) || null;
}

export function getMediaByFilename(filename) {
  return getDb().prepare("SELECT * FROM media WHERE filename = ?").get(filename) || null;
}

export function listMedia({ q = "", page = 1, perPage = 24 } = {}) {
  const db = getDb();
  const safePerPage = Math.min(100, Math.max(1, Number(perPage) || 24));
  const safePage = Math.max(1, Number(page) || 1);
  const params = [];
  let where = "";
  if (q) {
    where = "WHERE original_name LIKE ? OR alt LIKE ? OR filename LIKE ?";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM media ${where}`).get(...params).n;
  const items = db
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM media_usages mu WHERE mu.media_id = m.id) AS usage_count
       FROM media m ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, safePerPage, (safePage - 1) * safePerPage);
  return { items, total, page: safePage, perPage: safePerPage, totalPages: Math.max(1, Math.ceil(total / safePerPage)) };
}

export function updateMediaAlt(id, alt) {
  getDb().prepare("UPDATE media SET alt = ? WHERE id = ?").run(String(alt || "").slice(0, 300), id);
  return getMedia(id);
}

export function mediaUsageCount(id) {
  return getDb().prepare("SELECT COUNT(*) AS n FROM media_usages WHERE media_id = ?").get(id).n;
}

export function deleteMedia(id) {
  getDb().prepare("DELETE FROM media WHERE id = ?").run(id);
}

export function countMedia() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM media").get().n;
}
