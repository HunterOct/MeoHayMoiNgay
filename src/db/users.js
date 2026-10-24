import crypto from "node:crypto";
import { getDb } from "./index.js";
import { nowIso } from "../lib/time.js";
import { hashPassword } from "../lib/passwords.js";

const PUBLIC_FIELDS = "id, email, name, role, bio, is_active, last_login_at, created_at, updated_at";

export function createUser({ email, password, passwordHash, name, role = "author", bio = "" }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  return hashPassword(password).then((hash) => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, bio, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, String(email).trim().toLowerCase(), passwordHash || hash, name, role, bio, now, now);
    return findById(id);
  });
}

/** Synchronous variant used by seed scripts that already hold a hash. */
export function insertUser({ id = crypto.randomUUID(), email, passwordHash, name, role = "author", bio = "" }) {
  const db = getDb();
  const now = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, bio, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, String(email).trim().toLowerCase(), passwordHash, name, role, bio, now, now);
  return findById(id);
}

export function findById(id) {
  return getDb().prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(id) || null;
}

export function findByEmailWithHash(email) {
  return (
    getDb()
      .prepare(`SELECT ${PUBLIC_FIELDS}, password_hash FROM users WHERE email = ? COLLATE NOCASE`)
      .get(String(email).trim()) || null
  );
}

export function listUsers() {
  return getDb()
    .prepare(
      `SELECT ${PUBLIC_FIELDS},
              (SELECT COUNT(*) FROM posts p WHERE p.author_id = users.id AND p.deleted_at IS NULL) AS post_count
       FROM users ORDER BY created_at ASC`,
    )
    .all();
}

export function updateUser(id, patch) {
  const allowed = ["name", "email", "role", "bio", "is_active"];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(key === "email" ? String(patch[key]).trim().toLowerCase() : patch[key]);
    }
  }
  if (!sets.length) return findById(id);
  sets.push("updated_at = ?");
  values.push(nowIso(), id);
  getDb().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return findById(id);
}

export function setPasswordHash(id, passwordHash) {
  getDb()
    .prepare("UPDATE users SET password_hash = ?, updated_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?")
    .run(passwordHash, nowIso(), id);
}

export function setUserPassword(id, password) {
  return hashPassword(password).then((hash) => setPasswordHash(id, hash));
}

export function markLoginSuccess(id) {
  getDb()
    .prepare("UPDATE users SET last_login_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?")
    .run(nowIso(), id);
}

export function registerFailedLogin(id, threshold = 8, lockMinutes = 15) {
  const db = getDb();
  const user = db.prepare("SELECT failed_attempts FROM users WHERE id = ?").get(id);
  if (!user) return;
  const attempts = user.failed_attempts + 1;
  const lockedUntil =
    attempts >= threshold ? new Date(Date.now() + lockMinutes * 60 * 1000).toISOString() : null;
  db.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(
    attempts,
    lockedUntil,
    id,
  );
}

export function isLocked(user) {
  return Boolean(user.locked_until && new Date(user.locked_until) > new Date());
}

export function countUsers() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM users").get().n;
}

export function createAdminIfMissing({ email, passwordHash, name = "Bé Dâu" }) {
  const existing = findByEmailWithHash(email);
  if (existing) return { user: findById(existing.id), created: false };
  const user = insertUser({ email, passwordHash, name, role: "admin", bio: "" });
  return { user, created: true };
}
