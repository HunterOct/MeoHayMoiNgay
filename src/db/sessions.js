import { getDb } from "./index.js";
import { config } from "../config.js";
import { nowIso } from "../lib/time.js";
import { randomToken, sha256 } from "../lib/passwords.js";

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function createSession(userId, { ip = "", userAgent = "" } = {}) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = Date.now();
  const expires = new Date(now + config.sessionTtlHours * 3600 * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sha256(token), userId, csrf, ip, String(userAgent).slice(0, 300), new Date(now).toISOString(), new Date(now).toISOString(), expires);
  return { token, csrf, expires };
}

export function findSession(token) {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.created_at, s.last_seen_at, s.expires_at, s.user_id,
              u.email, u.name, u.role, u.bio, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sha256(token));
  if (!row) return null;
  const now = new Date();
  if (new Date(row.expires_at) <= now) {
    destroySessionById(row.session_id);
    return null;
  }
  const idleMs = now.getTime() - new Date(row.last_seen_at).getTime();
  if (idleMs > config.sessionIdleHours * 3600 * 1000) {
    destroySessionById(row.session_id);
    return null;
  }
  if (!row.is_active) {
    destroySessionById(row.session_id);
    return null;
  }
  if (idleMs > TOUCH_INTERVAL_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now.toISOString(), row.session_id);
  }
  return row;
}

export function destroySession(token) {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

export function destroySessionById(sessionId) {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function destroyUserSessions(userId) {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function cleanupSessions() {
  const now = nowIso();
  const idleCutoff = new Date(Date.now() - config.sessionIdleHours * 3600 * 1000).toISOString();
  return getDb()
    .prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?")
    .run(now, idleCutoff).changes;
}

export function recordLoginAttempt(email, ip, success) {
  getDb()
    .prepare("INSERT INTO login_attempts (email, ip, success, created_at) VALUES (?, ?, ?, ?)")
    .run(String(email).toLowerCase(), ip || null, success ? 1 : 0, nowIso());
}

export function cleanupLoginAttempts(days = 30) {
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
  return getDb().prepare("DELETE FROM login_attempts WHERE created_at < ?").run(cutoff).changes;
}

export function recentFailedAttempts(email, minutes = 15) {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  return getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND success = 0 AND created_at > ?",
    )
    .get(String(email).toLowerCase(), since).n;
}
