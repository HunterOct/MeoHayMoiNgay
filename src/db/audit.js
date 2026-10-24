import { getDb } from "./index.js";
import { nowIso } from "../lib/time.js";
import { logger } from "../lib/logger.js";

export function logAudit({
  actorType = "system",
  actorId = null,
  action,
  entityType = null,
  entityId = null,
  meta = null,
  ip = null,
  userAgent = null,
}) {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, meta, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actorType,
        actorId,
        action,
        entityType,
        entityId,
        JSON.stringify(meta || {}),
        ip,
        String(userAgent || "").slice(0, 300),
        nowIso(),
      );
  } catch (error) {
    logger.error("audit.write_failed", { action, error: error.message });
  }
}

const throttled = new Map();

/** Throttle noisy security events (per action+IP+actor) to avoid filling the DB. */
export function logAuditThrottled(entry, windowMs = 10 * 60 * 1000) {
  const key = `${entry.action}:${entry.ip || ""}:${entry.actorId || ""}`;
  const now = Date.now();
  const last = throttled.get(key);
  if (last && now - last < windowMs) return false;
  throttled.set(key, now);
  if (throttled.size > 5000) {
    for (const [cacheKey, at] of throttled) {
      if (now - at >= windowMs) throttled.delete(cacheKey);
    }
  }
  logAudit(entry);
  return true;
}

export function listAudit({ action = "", actorType = "", entityType = "", limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (action) {
    clauses.push("a.action LIKE ?");
    params.push(`${action}%`);
  }
  if (actorType) {
    clauses.push("a.actor_type = ?");
    params.push(actorType);
  }
  if (entityType) {
    clauses.push("a.entity_type = ?");
    params.push(entityType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${where}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT a.*, COALESCE(u.name, c.name) AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON a.actor_type = 'user' AND u.id = a.actor_id
       LEFT JOIN api_clients c ON a.actor_type = 'api' AND c.id = a.actor_id
       ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, Math.min(200, Number(limit) || 50), Number(offset) || 0)
    .map((row) => {
      let meta = {};
      try {
        meta = JSON.parse(row.meta);
      } catch {
        meta = {};
      }
      return { ...row, meta };
    });
  return { rows, total };
}

export function countSecurityEventsSince(sinceIso) {
  return getDb()
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'security.%' AND created_at >= ?")
    .get(sinceIso).n;
}

export function recentSecurityEvents(limit = 20) {
  return getDb()
    .prepare(
      `SELECT a.*, COALESCE(u.name, c.name) AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON a.actor_type = 'user' AND u.id = a.actor_id
       LEFT JOIN api_clients c ON a.actor_type = 'api' AND c.id = a.actor_id
       WHERE a.action LIKE 'security.%' ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => {
      try {
        return { ...row, meta: JSON.parse(row.meta) };
      } catch {
        return { ...row, meta: {} };
      }
    });
}

export function purgeAuditOlderThan(days = 180) {
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
  return getDb().prepare("DELETE FROM audit_log WHERE created_at < ?").run(cutoff).changes;
}
