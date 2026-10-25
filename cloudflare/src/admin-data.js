import { slugify, nowIso } from "./db.js";
import { plainText } from "./text.js";
import { randomToken, sha256Hex } from "./token.js";
import { assertMediaReady, syncMediaUsages } from "./media-service.js";

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const SESSION_IDLE_MS = 8 * 3600 * 1000;
const SESSION_TOUCH_MS = 5 * 60 * 1000;

/* ---------------- users ---------------- */

const USER_FIELDS =
  "id, email, name, role, bio, is_active, last_login_at, failed_attempts, locked_until, created_at, updated_at";

export async function findUserByEmail(db, email) {
  return db
    .prepare(`SELECT ${USER_FIELDS}, password_hash FROM users WHERE email = ? COLLATE NOCASE LIMIT 1`)
    .bind(String(email || "").trim())
    .first();
}

export async function findUserById(db, id) {
  return db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ? LIMIT 1`).bind(id).first();
}

export async function listAdminUsers(db) {
  const result = await db
    .prepare(
      `SELECT ${USER_FIELDS},
              (SELECT COUNT(*) FROM posts p WHERE p.author_id = users.id AND p.deleted_at IS NULL) AS post_count
       FROM users ORDER BY created_at ASC`,
    )
    .all();
  return result.results || [];
}

export async function createAdminUser(db, { email, passwordHash, name, role, bio = "" }) {
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, name, role, bio, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, String(email).trim().toLowerCase(), passwordHash, name, role, bio, now, now)
    .run();
  return findUserById(db, id);
}

export async function updateAdminUser(db, id, patch) {
  const fields = [];
  const values = [];
  for (const key of ["name", "email", "role", "bio", "is_active"]) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(key === "email" ? String(patch[key]).trim().toLowerCase() : patch[key]);
    }
  }
  if (!fields.length) return findUserById(db, id);
  fields.push("updated_at = ?");
  values.push(nowIso(), id);
  await db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return findUserById(db, id);
}

export async function setUserPasswordHash(db, id, passwordHash) {
  await db
    .prepare("UPDATE users SET password_hash = ?, updated_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?")
    .bind(passwordHash, nowIso(), id)
    .run();
}

export async function markLoginSuccess(db, id) {
  await db
    .prepare("UPDATE users SET last_login_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?")
    .bind(nowIso(), id)
    .run();
}

export async function registerFailedLogin(db, id, threshold = 8, lockMinutes = 15) {
  const user = await db.prepare("SELECT failed_attempts FROM users WHERE id = ?").bind(id).first();
  if (!user) return;
  const attempts = Number(user.failed_attempts || 0) + 1;
  const lockedUntil =
    attempts >= threshold ? new Date(Date.now() + lockMinutes * 60_000).toISOString() : null;
  await db
    .prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?")
    .bind(attempts, lockedUntil, id)
    .run();
}

export function isAccountLocked(user) {
  return Boolean(user?.locked_until && new Date(user.locked_until) > new Date());
}

export async function countApiClients(db) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM api_clients").first();
  return Number(row?.n || 0);
}

export async function countUsers(db) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users").first();
  return Number(row?.n || 0);
}

export async function countActiveAdmins(db) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1")
    .first();
  return Number(row?.n || 0);
}

/* ---------------- sessions ---------------- */

export async function createAdminSession(db, userId, { ip = "", userAgent = "" } = {}) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = Date.now();
  const expires = new Date(now + SESSION_TTL_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256Hex(token),
      userId,
      csrf,
      String(ip || "").slice(0, 80),
      String(userAgent || "").slice(0, 300),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      expires,
    )
    .run();
  return { token, csrf, expires };
}

export async function findAdminSession(db, token) {
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.created_at, s.last_seen_at, s.expires_at,
              u.id AS user_id, u.email, u.name, u.role, u.bio, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? LIMIT 1`,
    )
    .bind(id)
    .first();
  if (!row) return null;
  const now = Date.now();
  const lastSeen = new Date(row.last_seen_at || row.created_at).getTime();
  if (new Date(row.expires_at).getTime() <= now || now - lastSeen > SESSION_IDLE_MS || !row.is_active) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }
  if (now - lastSeen > SESSION_TOUCH_MS) {
    await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(new Date(now).toISOString(), row.session_id).run();
  }
  return row;
}

export async function destroyAdminSession(db, token) {
  if (!token) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
}

export async function destroyUserSessions(db, userId) {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

export async function cleanupOperationalData(db, { limit = 50 } = {}) {
  const now = nowIso();
  const idleCutoff = new Date(Date.now() - 8 * 3600_000).toISOString();
  const loginCutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const idemCutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const results = await db.batch([
    db.prepare(
      "DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at <= ? OR last_seen_at <= ? LIMIT ?)",
    ).bind(now, idleCutoff, safeLimit),
    db.prepare(
      "DELETE FROM login_attempts WHERE id IN (SELECT id FROM login_attempts WHERE created_at < ? LIMIT ?)",
    ).bind(loginCutoff, safeLimit),
    db.prepare(
      "DELETE FROM idempotency_keys WHERE rowid IN (SELECT rowid FROM idempotency_keys WHERE created_at < ? LIMIT ?)",
    ).bind(idemCutoff, safeLimit),
  ]);
  return {
    sessions: Number(results?.[0]?.meta?.changes || 0),
    login_attempts: Number(results?.[1]?.meta?.changes || 0),
    idempotency_keys: Number(results?.[2]?.meta?.changes || 0),
  };
}

export async function retentionPreview(db, { auditDays = 180, revisionDays = 365 } = {}) {
  const auditCutoff = new Date(Date.now() - auditDays * 86400_000).toISOString();
  const revisionCutoff = new Date(Date.now() - revisionDays * 86400_000).toISOString();
  const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE created_at < ?").bind(auditCutoff).first();
  const revisions = await db.prepare("SELECT COUNT(*) AS n FROM revisions WHERE created_at < ?").bind(revisionCutoff).first();
  return { audit_older_than_days: auditDays, audit_rows: Number(audit?.n || 0), revision_older_than_days: revisionDays, revision_rows: Number(revisions?.n || 0) };
}

export async function recordLoginAttempt(db, email, ip, success) {
  await db
    .prepare("INSERT INTO login_attempts (email, ip, success, created_at) VALUES (?, ?, ?, ?)")
    .bind(String(email).toLowerCase(), ip || null, success ? 1 : 0, nowIso())
    .run();
}

/* ---------------- audit ---------------- */

export async function logAudit(db, {
  actorType = "system",
  actorId = null,
  action,
  entityType = null,
  entityId = null,
  meta = null,
  ip = null,
  userAgent = null,
} = {}) {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, meta, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        actorType,
        actorId,
        action,
        entityType,
        entityId,
        JSON.stringify(meta || {}),
        ip,
        String(userAgent || "").slice(0, 300),
        nowIso(),
      )
      .run();
  } catch (error) {
    console.error("audit.write_failed", action, error.message);
  }
}

function hydrateAudit(row) {
  try {
    return { ...row, meta: JSON.parse(row.meta || "{}") };
  } catch {
    return { ...row, meta: {} };
  }
}

export async function listAuditRows(db, {
  action = "",
  actorType = "",
  scope = "all",
  limit = 40,
  offset = 0,
} = {}) {
  const clauses = [];
  const params = [];
  if (action) {
    clauses.push("a.action LIKE ?");
    params.push(`${action}%`);
  }
  if (scope === "security") {
    clauses.push("a.action LIKE 'security.%'");
  }
  if (actorType) {
    clauses.push("a.actor_type = ?");
    params.push(actorType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${where}`).bind(...params).first();
  const result = await db
    .prepare(
      `SELECT a.*, COALESCE(u.name, c.name) AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON a.actor_type = 'user' AND u.id = a.actor_id
       LEFT JOIN api_clients c ON a.actor_type = 'api' AND c.id = a.actor_id
       ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params, Math.min(200, Number(limit) || 40), Math.max(0, Number(offset) || 0))
    .all();
  return {
    rows: (result.results || []).map(hydrateAudit),
    total: Number(totalRow?.n || 0),
  };
}

export async function recentSecurityEvents(db, limit = 5) {
  const result = await db
    .prepare(
      `SELECT a.*, COALESCE(u.name, c.name) AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON a.actor_type = 'user' AND u.id = a.actor_id
       LEFT JOIN api_clients c ON a.actor_type = 'api' AND c.id = a.actor_id
       WHERE a.action LIKE 'security.%' ORDER BY a.id DESC LIMIT ?`,
    )
    .bind(Math.min(20, Number(limit) || 5))
    .all();
  return (result.results || []).map(hydrateAudit);
}

export async function countSecurityEventsSince(db, sinceIso) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'security.%' AND created_at >= ?")
    .bind(sinceIso)
    .first();
  return Number(row?.n || 0);
}

/* ---------------- api clients ---------------- */

function hydrateClient(row) {
  if (!row) return null;
  let scopes = [];
  try {
    scopes = JSON.parse(row.scopes || "[]");
  } catch {
    scopes = [];
  }
  return { ...row, scopes };
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listAdminApiClients(db) {
  const result = await db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.api_client_id = c.id) AS post_count
       FROM api_clients c ORDER BY c.created_at DESC`,
    )
    .all();
  return (result.results || []).map(hydrateClient);
}

export async function getAdminApiClient(db, id) {
  return hydrateClient(await db.prepare("SELECT * FROM api_clients WHERE id = ?").bind(id).first());
}

export async function createAdminApiClient(db, { name, scopes, publishMode, rateLimitPerMin }) {
  const id = crypto.randomUUID();
  const keyId = hex(crypto.getRandomValues(new Uint8Array(5)));
  const secret = randomToken(32);
  await db
    .prepare(
      `INSERT INTO api_clients (id, name, key_id, key_hash, scopes, publish_mode, rate_limit_per_min, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(id, name, keyId, await sha256Hex(secret), JSON.stringify(scopes), publishMode, rateLimitPerMin, nowIso())
    .run();
  return { client: await getAdminApiClient(db, id), key: `mh_${keyId}_${secret}` };
}

export async function updateAdminApiClient(db, id, { name, scopes, publishMode, rateLimitPerMin }) {
  await db
    .prepare(
      "UPDATE api_clients SET name = ?, scopes = ?, publish_mode = ?, rate_limit_per_min = ? WHERE id = ?",
    )
    .bind(name, JSON.stringify(scopes), publishMode, rateLimitPerMin, id)
    .run();
  return getAdminApiClient(db, id);
}

export async function revokeAdminApiClient(db, id) {
  await db.prepare("UPDATE api_clients SET is_active = 0, revoked_at = ? WHERE id = ?").bind(nowIso(), id).run();
  return getAdminApiClient(db, id);
}

export async function rotateAdminApiKey(db, id) {
  const client = await getAdminApiClient(db, id);
  if (!client) return null;
  const secret = randomToken(32);
  await db
    .prepare("UPDATE api_clients SET key_hash = ?, is_active = 1, revoked_at = NULL WHERE id = ?")
    .bind(await sha256Hex(secret), id)
    .run();
  return { client: await getAdminApiClient(db, id), key: `mh_${client.key_id}_${secret}` };
}

/* ---------------- taxonomy ---------------- */

export async function listAdminCategories(db) {
  const result = await db
    .prepare(
      "SELECT c.*, c.cached_post_count AS post_count FROM categories c ORDER BY c.sort_order ASC, c.name ASC",
    )
    .all();
  return result.results || [];
}

export async function getAdminCategory(db, id) {
  return db.prepare("SELECT * FROM categories WHERE id = ? LIMIT 1").bind(id).first();
}

async function categorySlugTaken(db, slug, excludeId = null) {
  const row = await db
    .prepare("SELECT id FROM categories WHERE slug = ? AND (? IS NULL OR id <> ?) LIMIT 1")
    .bind(slug, excludeId, excludeId)
    .first();
  return Boolean(row);
}

async function uniqueCategorySlug(db, value, excludeId = null) {
  const base = slugify(value) || "chuyen-muc";
  let slug = base;
  let n = 2;
  while (await categorySlugTaken(db, slug, excludeId)) slug = `${base}-${n++}`;
  return slug;
}

export async function createAdminCategory(db, { name, slug, group, description, sortOrder }) {
  const id = crypto.randomUUID();
  const finalSlug = await uniqueCategorySlug(db, slug || name);
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO categories (id, name, slug, group_name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, name.trim(), finalSlug, group, description, sortOrder, now, now)
    .run();
  return getAdminCategory(db, id);
}

export async function updateAdminCategory(db, id, { name, slug, group, description, sortOrder }) {
  const existing = await getAdminCategory(db, id);
  if (!existing) return null;
  let finalSlug = existing.slug;
  if (slug && slugify(slug) !== existing.slug) {
    if (await categorySlugTaken(db, slugify(slug), id)) {
      const error = new Error("Slug chuyên mục đã tồn tại");
      error.code = "SLUG_TAKEN";
      throw error;
    }
    finalSlug = slugify(slug);
  }
  await db
    .prepare(
      "UPDATE categories SET name = ?, slug = ?, group_name = ?, description = ?, sort_order = ?, updated_at = ? WHERE id = ?",
    )
    .bind(name.trim(), finalSlug, group, description, sortOrder, nowIso(), id)
    .run();
  return getAdminCategory(db, id);
}

export async function deleteAdminCategory(db, id, { reassignTo = null } = {}) {
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE category_id = ?")
    .bind(id)
    .first();
  const used = Number(count?.n || 0);
  if (used > 0 && !reassignTo) {
    const error = new Error("Chuyên mục đang được sử dụng");
    error.code = "CATEGORY_IN_USE";
    throw error;
  }
  const statements = [];
  if (used > 0) {
    statements.push(
      db.prepare("UPDATE posts SET category_id = ?, updated_at = ? WHERE category_id = ?").bind(reassignTo, nowIso(), id),
    );
  }
  statements.push(db.prepare("DELETE FROM categories WHERE id = ?").bind(id));
  await db.batch(statements);
}

export async function listAdminTags(db) {
  const result = await db
    .prepare("SELECT t.*, t.cached_post_count AS post_count FROM tags t ORDER BY t.name ASC")
    .all();
  return result.results || [];
}

async function tagSlugTaken(db, slug, excludeId = null) {
  const row = await db
    .prepare("SELECT id FROM tags WHERE slug = ? AND (? IS NULL OR id <> ?) LIMIT 1")
    .bind(slug, excludeId, excludeId)
    .first();
  return Boolean(row);
}

async function uniqueTagSlug(db, value, excludeId = null) {
  const base = slugify(value) || "the";
  let slug = base;
  let n = 2;
  while (await tagSlugTaken(db, slug, excludeId)) slug = `${base}-${n++}`;
  return slug;
}

export async function createAdminTag(db, { name, slug }) {
  const existing = await db
    .prepare("SELECT * FROM tags WHERE name = ? COLLATE NOCASE OR slug = ? LIMIT 1")
    .bind(name, slugify(name))
    .first();
  if (existing) {
    const error = new Error("Tên hoặc slug thẻ đã tồn tại");
    error.code = "SLUG_TAKEN";
    throw error;
  }
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO tags (id, name, slug, cached_post_count) VALUES (?, ?, ?, 0)")
    .bind(id, name.trim(), await uniqueTagSlug(db, slug || name))
    .run();
  return db.prepare("SELECT * FROM tags WHERE id = ?").bind(id).first();
}

export async function updateAdminTag(db, id, { name, slug }) {
  const existing = await db.prepare("SELECT * FROM tags WHERE id = ? ").bind(id).first();
  if (!existing) return null;
  let finalSlug = existing.slug;
  if (slug && slugify(slug) !== existing.slug) {
    if (await tagSlugTaken(db, slugify(slug), id)) {
      const error = new Error("Slug thẻ đã tồn tại");
      error.code = "SLUG_TAKEN";
      throw error;
    }
    finalSlug = slugify(slug);
  }
  await db.prepare("UPDATE tags SET name = ?, slug = ? WHERE id = ?").bind(name.trim(), finalSlug, id).run();
  return db.prepare("SELECT * FROM tags WHERE id = ?").bind(id).first();
}

export async function deleteAdminTag(db, id) {
  await db.batch([
    db.prepare("DELETE FROM post_tags WHERE tag_id = ?").bind(id),
    db.prepare("DELETE FROM tags WHERE id = ?").bind(id),
  ]);
}

/* ---------------- posts ---------------- */

async function slugTaken(db, slug, excludeId = null) {
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM posts WHERE slug = ? AND (? IS NULL OR id <> ?)
       UNION ALL
       SELECT 1 AS hit FROM slug_history WHERE slug = ? AND (? IS NULL OR post_id <> ?)
       LIMIT 1`,
    )
    .bind(slug, excludeId, excludeId, slug, excludeId, excludeId)
    .first();
  return Boolean(row);
}

async function uniquePostSlug(db, value, excludeId = null) {
  const base = slugify(value) || "bai-viet";
  let slug = base;
  let n = 2;
  while (await slugTaken(db, slug, excludeId)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

async function tagsForAdmin(db, postId) {
  const result = await db
    .prepare(
      `SELECT t.id, t.name, t.slug FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = ? ORDER BY t.name ASC`,
    )
    .bind(postId)
    .all();
  return result.results || [];
}

export async function getAdminPost(db, id, { includeTags = true } = {}) {
  const post = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
              u.name AS author_name, u.bio AS author_bio
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.id = ? LIMIT 1`,
    )
    .bind(id)
    .first();
  if (!post) return null;
  post.tags = includeTags ? await tagsForAdmin(db, post.id) : [];
  return post;
}

export async function listAdminPosts(db, {
  status = "",
  q = "",
  categoryId = "",
  authorId = "",
  deleted = false,
  page = 1,
  perPage = 20,
} = {}) {
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
  const safePage = Math.max(1, Number(page) || 1);
  const safePerPage = Math.min(100, Math.max(1, Number(perPage) || 20));
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM posts p ${where}`).bind(...params).first();
  const total = Number(totalRow?.n || 0);
  const result = await db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.cover_image, p.status, p.category_id, p.author_id,
              p.updated_at, p.deleted_at, p.version, c.name AS category_name, u.name AS author_name
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       ${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params, safePerPage, (safePage - 1) * safePerPage)
    .all();
  return {
    items: result.results || [],
    total,
    page: safePage,
    perPage: safePerPage,
    totalPages: Math.max(1, Math.ceil(total / safePerPage)),
  };
}

export async function listUpcomingAdmin(db, limit = 5, { authorId = null } = {}) {
  const sql = `SELECT p.id, p.slug, p.title, p.status, p.scheduled_at, p.author_id, c.name AS category_name
     FROM posts p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status = 'scheduled' AND p.deleted_at IS NULL ${authorId ? "AND p.author_id = ?" : ""}
     ORDER BY p.scheduled_at ASC LIMIT ?`;
  const result = authorId
    ? await db.prepare(sql).bind(authorId, limit).all()
    : await db.prepare(sql).bind(limit).all();
  return result.results || [];
}

const statusCountCache = new Map();
const STATUS_CACHE_MS = 3000;

export function invalidateAdminCounts() {
  statusCountCache.clear();
}

export async function countByStatusAdmin(db, authorId = "") {
  const cacheKey = authorId || "all";
  const cached = statusCountCache.get(cacheKey);
  if (cached && Date.now() - cached.at < STATUS_CACHE_MS) return { ...cached.value };
  const counts = { draft: 0, review: 0, scheduled: 0, published: 0, archived: 0, trash: 0, total: 0 };
  const result = await db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM posts WHERE deleted_at IS NULL ${authorId ? "AND author_id = ?" : ""} GROUP BY status`,
    )
    .bind(...(authorId ? [authorId] : []))
    .all();
  for (const row of result.results || []) {
    counts[row.status] = Number(row.n || 0);
    counts.total += Number(row.n || 0);
  }
  const trash = await db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NOT NULL" + (authorId ? " AND author_id = ?" : ""))
    .bind(...(authorId ? [authorId] : []))
    .first();
  counts.trash = Number(trash?.n || 0);
  counts.posts = counts.total;
  statusCountCache.set(cacheKey, { at: Date.now(), value: counts });
  return { ...counts };
}

function normalizeStatusDates(status, { publishedAt = null, scheduledAt = null, existing = {} } = {}) {
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

async function ensureTagId(db, name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const existing = await db
    .prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE OR slug = ? LIMIT 1")
    .bind(clean, slugify(clean))
    .first();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO tags (id, name, slug, cached_post_count) VALUES (?, ?, ?, 0)")
    .bind(id, clean, await uniqueTagSlug(db, clean))
    .run();
  return id;
}

async function resolveTagIds(db, names) {
  const ids = [];
  for (const name of names || []) {
    const id = await ensureTagId(db, name);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function revisionStatement(db, post, actor) {
  return db
    .prepare(
      `INSERT INTO revisions
        (id, post_id, title, excerpt, content_html, content_source, content_format, seo_title, seo_description,
         cover_image, status, edited_by_type, edited_by_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      post.id,
      post.title,
      post.excerpt || "",
      post.content_html || "",
      post.content_source || "",
      post.content_format || "html",
      post.seo_title || "",
      post.seo_description || "",
      post.cover_image || "",
      post.status,
      actor.actorType || "user",
      actor.actorId || null,
      nowIso(),
    );
}

export async function listApiPosts(db, { status = "", categoryId = "", q = "", limit = 20, offset = 0 } = {}) {
  const clauses = ["p.deleted_at IS NULL"];
  const params = [];
  if (status) {
    clauses.push("p.status = ?");
    params.push(status);
  }
  if (categoryId) {
    clauses.push("p.category_id = ?");
    params.push(categoryId);
  }
  if (q) {
    clauses.push("(p.title LIKE ? OR p.slug LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM posts p ${where}`).bind(...params).first();
  const result = await db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.excerpt, p.lede, p.content_format, p.status,
              p.category_id, p.author_id, p.cover_image, p.cover_alt, p.cover_caption,
              p.seo_title, p.seo_description, p.focus_keyword, p.canonical_url, p.og_image,
              p.is_featured, p.read_minutes, p.views, p.external_id, p.published_at, p.scheduled_at,
              p.created_at, p.updated_at, p.deleted_at,
              c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
              u.name AS author_name,
              COALESCE((SELECT json_group_array(t.name) FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                        WHERE pt.post_id = p.id), '[]') AS tag_names
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       ${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params, safeLimit, safeOffset)
    .all();
  const items = (result.results || []).map((post) => {
    try {
      post.tags = JSON.parse(post.tag_names || "[]").map((name) => ({ name }));
    } catch {
      post.tags = [];
    }
    return post;
  });
  return { items, total: Number(totalRow?.n || 0), limit: safeLimit, offset: safeOffset };
}

export async function getApiPostBySlug(db, slug) {
  const row = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
              u.name AS author_name, u.bio AS author_bio
       FROM posts p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN users u ON u.id = p.author_id
       WHERE p.slug = ? LIMIT 1`,
    )
    .bind(slug)
    .first();
  if (!row) return null;
  row.tags = await tagsForAdmin(db, row.id);
  return row;
}

export async function findApiPostByExternal(db, clientId, externalId) {
  const row = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.group_name AS category_group,
              u.name AS author_name, u.bio AS author_bio
       FROM posts p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN users u ON u.id = p.author_id
       WHERE p.api_client_id = ? AND p.external_id = ? LIMIT 1`,
    )
    .bind(clientId, externalId)
    .first();
  if (!row) return null;
  row.tags = await tagsForAdmin(db, row.id);
  return row;
}

export async function resolveApiCategory(db, value) {
  if (!value) return null;
  const byId = await db.prepare("SELECT * FROM categories WHERE id = ? LIMIT 1").bind(value).first();
  if (byId) return byId;
  const bySlug = await db
    .prepare("SELECT * FROM categories WHERE slug = ? LIMIT 1")
    .bind(slugify(value))
    .first();
  return bySlug || null;
}

let authorCache = { at: 0, id: null };

export async function defaultApiAuthorId(db) {
  if (authorCache.id && Date.now() - authorCache.at < 5000) return authorCache.id;
  const settings = await db.prepare("SELECT value FROM settings WHERE key = 'default_author_id' LIMIT 1").first();
  let id = null;
  if (settings?.value) {
    const user = await db.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1").bind(settings.value).first();
    id = user?.id || null;
  }
  if (!id) {
    const admin = await db
      .prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY created_at ASC LIMIT 1")
      .first();
    if (admin) id = admin.id;
  }
  if (!id) {
    const any = await db.prepare("SELECT id FROM users WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1").first();
    id = any?.id || null;
  }
  authorCache = { at: Date.now(), id };
  return id;
}

export async function createAdminPost(db, data, actor = {}, { includeTags = true } = {}) {
  invalidateAdminCounts();
  const text = plainText(data.contentHtml || "");
  const readMinutes =
    data.readMinutes || Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200));
  const id = crypto.randomUUID();
  const now = nowIso();
  const slug = await uniquePostSlug(db, data.slug || data.title);
  const dates = normalizeStatusDates(data.status || "draft", {
    publishedAt: data.publishedAt,
    scheduledAt: data.scheduledAt,
  });
  const tagIds = await resolveTagIds(db, data.tags || []);
  const statements = [
    db
      .prepare(
        `INSERT INTO posts
          (id, slug, title, excerpt, lede, content_html, content_source, content_format, status, category_id,
           author_id, cover_image, cover_alt, cover_caption, seo_title, seo_description, focus_keyword,
           canonical_url, og_image, is_featured, read_minutes, views, published_at, scheduled_at, created_at,
           updated_at, origin, api_client_id, external_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        slug,
        data.title,
        data.excerpt || "",
        data.lede || "",
        data.contentHtml || "",
        data.contentSource || "",
        data.contentFormat || "html",
        data.status || "draft",
        data.categoryId || null,
        data.authorId || null,
        data.coverImage || "",
        data.coverAlt || "",
        data.coverCaption || "",
        data.seoTitle || "",
        data.seoDescription || "",
        data.focusKeyword || "",
        data.canonicalUrl || "",
        data.ogImage || "",
        data.isFeatured ? 1 : 0,
        readMinutes,
        dates.publishedAt,
        dates.scheduledAt,
        now,
        now,
        data.origin || "admin",
        data.apiClientId || null,
        data.externalId || null,
      ),
    db.prepare("INSERT INTO posts_fts (post_id, title, excerpt, content) VALUES (?, ?, ?, ?)").bind(
      id,
      data.title,
      data.excerpt || "",
      text,
    ),
    ...tagIds.map((tagId) =>
      db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)").bind(id, tagId),
    ),
    revisionStatement(
      db,
      {
        id,
        title: data.title,
        excerpt: data.excerpt,
        content_html: data.contentHtml,
        content_source: data.contentSource,
        content_format: data.contentFormat,
        seo_title: data.seoTitle,
        seo_description: data.seoDescription,
        cover_image: data.coverImage,
        status: data.status || "draft",
      },
      actor,
    ),
  ];
  if (["published", "scheduled"].includes(String(data.status || "draft"))) {
    await assertMediaReady(db, {
      coverImage: data.coverImage,
      ogImage: data.ogImage,
      contentHtml: data.contentHtml,
    });
  }
  await db.batch(statements);
  await syncMediaUsages(db, id);
  return getAdminPost(db, id, { includeTags });
}

export async function updateAdminPost(db, id, patch, actor = {}, { expectedVersion = null } = {}) {
  invalidateAdminCounts();
  const existing = await getAdminPost(db, id);
  if (!existing) return null;
  const expected = expectedVersion === null || expectedVersion === undefined ? Number(existing.version) : Number(expectedVersion);
  if (!Number.isFinite(expected) || expected !== Number(existing.version)) {
    const error = new Error("VERSION_CONFLICT");
    error.code = "VERSION_CONFLICT";
    error.currentVersion = Number(existing.version);
    throw error;
  }
  const next = { ...existing, ...patch };
  const contentHtml = patch.contentHtml !== undefined ? patch.contentHtml : existing.content_html;
  const contentSource = patch.contentSource !== undefined ? patch.contentSource : existing.content_source;
  const contentFormat = patch.contentFormat !== undefined ? patch.contentFormat : existing.content_format;
  const text = patch.text !== undefined ? patch.text : plainText(contentHtml || "");
  const readMinutes =
    patch.readMinutes !== undefined && patch.readMinutes !== null
      ? Number(patch.readMinutes) || 1
      : Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200));
  const status = patch.status !== undefined ? patch.status : existing.status;
  const dates = normalizeStatusDates(status, {
    publishedAt: patch.publishedAt,
    scheduledAt: patch.scheduledAt,
    existing,
  });
  let slug = existing.slug;
  if (patch.slug !== undefined && String(patch.slug).trim() && slugify(patch.slug) !== existing.slug) {
    slug = await uniquePostSlug(db, patch.slug, id);
  }
  const tagsChanged = patch.tags !== undefined;
  const tagIds = tagsChanged
    ? await resolveTagIds(db, patch.tags)
    : (await tagsForAdmin(db, id)).map((tag) => tag.id);
  const newVersion = expected + 1;
  const changeId = crypto.randomUUID();
  const updatedAt = nowIso();
  const guard = "EXISTS (SELECT 1 FROM posts p WHERE p.id = ? AND p.change_id = ? AND p.version = ?)";
  const guardValues = [id, changeId, newVersion];
  const statements = [
    db
      .prepare(
        `UPDATE posts SET
          slug = ?, title = ?, excerpt = ?, lede = ?, content_html = ?, content_source = ?, content_format = ?,
          status = ?, category_id = ?, author_id = ?, cover_image = ?, cover_alt = ?, cover_caption = ?,
          seo_title = ?, seo_description = ?, focus_keyword = ?, canonical_url = ?, og_image = ?,
          is_featured = ?, read_minutes = ?, published_at = ?, scheduled_at = ?, updated_at = ?,
          version = ?, change_id = ?
         WHERE id = ? AND version = ?`,
      )
      .bind(
        slug,
        next.title,
        next.excerpt || "",
        next.lede || "",
        contentHtml || "",
        contentSource || "",
        contentFormat || "html",
        status,
        next.categoryId !== undefined ? next.categoryId : existing.category_id,
        next.authorId !== undefined ? next.authorId : existing.author_id,
        next.coverImage !== undefined ? next.coverImage : existing.cover_image,
        next.coverAlt !== undefined ? next.coverAlt : existing.cover_alt,
        next.coverCaption !== undefined ? next.coverCaption : existing.cover_caption,
        next.seoTitle !== undefined ? next.seoTitle : existing.seo_title,
        next.seoDescription !== undefined ? next.seoDescription : existing.seo_description,
        next.focusKeyword !== undefined ? next.focusKeyword : existing.focus_keyword,
        next.canonicalUrl !== undefined ? next.canonicalUrl : existing.canonical_url,
        next.ogImage !== undefined ? next.ogImage : existing.og_image,
        next.isFeatured ? 1 : 0,
        readMinutes,
        dates.publishedAt,
        dates.scheduledAt,
        updatedAt,
        newVersion,
        changeId,
        id,
        expected,
      ),
  ];
  if (slug !== existing.slug) {
    statements.push(
      db
        .prepare(`INSERT OR IGNORE INTO slug_history (post_id, slug, created_at) SELECT ?, ?, ? WHERE ${guard}`)
        .bind(id, existing.slug, updatedAt, ...guardValues),
    );
  }
  statements.push(
    db.prepare(`DELETE FROM posts_fts WHERE post_id = ? AND ${guard}`).bind(id, ...guardValues),
    db
      .prepare(`INSERT INTO posts_fts (post_id, title, excerpt, content) SELECT ?, ?, ?, ? WHERE ${guard}`)
      .bind(id, next.title, next.excerpt || "", text, ...guardValues),
  );
  if (tagsChanged) {
    statements.push(db.prepare(`DELETE FROM post_tags WHERE post_id = ? AND ${guard}`).bind(id, ...guardValues));
    for (const tagId of tagIds) {
      statements.push(
        db
          .prepare(`INSERT INTO post_tags (post_id, tag_id) SELECT ?, ? WHERE ${guard}`)
          .bind(id, tagId, ...guardValues),
      );
    }
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO revisions
          (id, post_id, title, excerpt, content_html, content_source, content_format, seo_title, seo_description,
           cover_image, status, edited_by_type, edited_by_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        existing.title,
        existing.excerpt || "",
        existing.content_html || "",
        existing.content_source || "",
        existing.content_format || "html",
        existing.seo_title || "",
        existing.seo_description || "",
        existing.cover_image || "",
        existing.status,
        actor.actorType || "user",
        actor.actorId || null,
        updatedAt,
        ...guardValues,
      ),
  );
  if (["published", "scheduled"].includes(String(status))) {
    await assertMediaReady(db, {
      ...next,
      coverImage: next.coverImage ?? next.cover_image,
      ogImage: next.ogImage ?? next.og_image,
      contentHtml,
    });
  }
  const results = await db.batch(statements);
  if (!(Number(results?.[0]?.meta?.changes || 0) > 0)) {
    const error = new Error("VERSION_CONFLICT");
    error.code = "VERSION_CONFLICT";
    error.currentVersion = Number(existing.version);
    throw error;
  }
  await syncMediaUsages(db, id);
  return getAdminPost(db, id);
}

export async function softDeleteAdminPost(db, id, { expectedVersion = null } = {}) {
  invalidateAdminCounts();
  const existing = await getAdminPost(db, id);
  if (!existing) return null;
  const expected = expectedVersion === null || expectedVersion === undefined ? Number(existing.version) : Number(expectedVersion);
  if (expected !== Number(existing.version)) {
    const error = new Error("VERSION_CONFLICT");
    error.code = "VERSION_CONFLICT";
    error.currentVersion = Number(existing.version);
    throw error;
  }
  const result = await db
    .prepare("UPDATE posts SET deleted_at = ?, updated_at = ?, version = version + 1, change_id = ? WHERE id = ? AND version = ?")
    .bind(nowIso(), nowIso(), crypto.randomUUID(), id, expected)
    .run();
  if (!(Number(result.meta?.changes || 0) > 0)) {
    const error = new Error("VERSION_CONFLICT");
    error.code = "VERSION_CONFLICT";
    error.currentVersion = Number(existing.version);
    throw error;
  }
  return getAdminPost(db, id);
}

export async function restoreAdminPost(db, id, { expectedVersion = null } = {}) {
  invalidateAdminCounts();
  const existing = await getAdminPost(db, id);
  if (!existing) return null;
  const expected = expectedVersion === null || expectedVersion === undefined ? Number(existing.version) : Number(expectedVersion);
  if (expected !== Number(existing.version)) {
    const error = new Error("VERSION_CONFLICT");
    error.code = "VERSION_CONFLICT";
    error.currentVersion = Number(existing.version);
    throw error;
  }
  const result = await db
    .prepare("UPDATE posts SET deleted_at = NULL, updated_at = ?, version = version + 1, change_id = ? WHERE id = ? AND version = ?")
    .bind(nowIso(), crypto.randomUUID(), id, expected)
    .run();
  if (!(Number(result.meta?.changes || 0) > 0)) {
    const error = new Error("VERSION_CONFLICT");
    error.code = "VERSION_CONFLICT";
    error.currentVersion = Number(existing.version);
    throw error;
  }
  return getAdminPost(db, id);
}

export async function purgeAdminPost(db, id, { expectedVersion = null } = {}) {
  invalidateAdminCounts();
  const existing = await getAdminPost(db, id);
  if (!existing) return null;
  const expected = expectedVersion === null || expectedVersion === undefined ? Number(existing.version) : Number(expectedVersion);
  if (!Number.isFinite(expected) || expected !== Number(existing.version)) {
    const error = new Error("VERSION_CONFLICT");
    error.code = "VERSION_CONFLICT";
    error.currentVersion = Number(existing.version);
    throw error;
  }
  const claimed = await db
    .prepare("UPDATE posts SET version = version + 1, change_id = ? WHERE id = ? AND version = ? AND deleted_at IS NOT NULL")
    .bind(crypto.randomUUID(), id, expected)
    .run();
  if (!(Number(claimed.meta?.changes || 0) > 0)) {
    const error = new Error("VERSION_CONFLICT");
    error.code = "VERSION_CONFLICT";
    error.currentVersion = Number(existing.version);
    throw error;
  }
  const claimedVersion = expected + 1;
  await db.batch([
    db.prepare("DELETE FROM post_tags WHERE post_id = ?").bind(id),
    db.prepare("DELETE FROM posts_fts WHERE post_id = ?").bind(id),
    db.prepare("DELETE FROM revisions WHERE post_id = ?").bind(id),
    db.prepare("DELETE FROM slug_history WHERE post_id = ?").bind(id),
    db.prepare("DELETE FROM media_usages WHERE post_id = ?").bind(id),
    db.prepare("DELETE FROM posts WHERE id = ? AND version = ?").bind(id, claimedVersion),
  ]);
  return true;
}

export async function listAdminRevisions(db, postId, limit = 30) {
  const result = await db
    .prepare("SELECT * FROM revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(postId, Math.min(100, Number(limit) || 30))
    .all();
  return result.results || [];
}

export async function getAdminRevision(db, id) {
  return db.prepare("SELECT * FROM revisions WHERE id = ? LIMIT 1").bind(id).first();
}
