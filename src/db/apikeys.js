import crypto from "node:crypto";
import { getDb } from "./index.js";
import { nowIso } from "../lib/time.js";
import { sha256, timingSafeEqualString } from "../lib/passwords.js";

export function createApiClient({
  name,
  scopes = ["posts:read", "posts:write"],
  publishMode = "review",
  rateLimitPerMin = 60,
}) {
  const db = getDb();
  const id = crypto.randomUUID();
  const keyId = crypto.randomBytes(5).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO api_clients (id, name, key_id, key_hash, scopes, publish_mode, rate_limit_per_min, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(id, name, keyId, sha256(secret), JSON.stringify(scopes), publishMode, rateLimitPerMin, nowIso());
  return { client: getApiClient(id), key: `mh_${keyId}_${secret}` };
}

export function getApiClient(id) {
  const row = getDb().prepare("SELECT * FROM api_clients WHERE id = ?").get(id);
  return row ? hydrate(row) : null;
}

function hydrate(row) {
  if (!row) return null;
  let scopes = [];
  try {
    scopes = JSON.parse(row.scopes);
  } catch {
    scopes = [];
  }
  return { ...row, scopes };
}

export function listApiClients() {
  return getDb()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.api_client_id = c.id) AS post_count
       FROM api_clients c ORDER BY c.created_at DESC`,
    )
    .all()
    .map(hydrate);
}

export function verifyApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;
  const match = /^mh_([a-f0-9]{10})_([A-Za-z0-9_-]{20,})$/.exec(rawKey.trim());
  if (!match) return null;
  const [, keyId, secret] = match;
  const db = getDb();
  const row = db.prepare("SELECT * FROM api_clients WHERE key_id = ?").get(keyId);
  if (!row) return null;
  if (!row.is_active || row.revoked_at) return null;
  if (!timingSafeEqualString(sha256(secret), row.key_hash)) return null;
  const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (!last || Date.now() - last > 60_000) {
    db.prepare("UPDATE api_clients SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
  }
  return hydrate(row);
}

export function revokeApiClient(id) {
  getDb().prepare("UPDATE api_clients SET is_active = 0, revoked_at = ? WHERE id = ?").run(nowIso(), id);
  return getApiClient(id);
}

export function rotateApiKey(id) {
  const client = getApiClient(id);
  if (!client) return null;
  const secret = crypto.randomBytes(32).toString("base64url");
  getDb()
    .prepare("UPDATE api_clients SET key_hash = ?, is_active = 1, revoked_at = NULL WHERE id = ?")
    .run(sha256(secret), id);
  return { client: getApiClient(id), key: `mh_${client.key_id}_${secret}` };
}

export function updateApiClient(id, { name, scopes, publishMode, rateLimitPerMin }) {
  const db = getDb();
  const existing = getApiClient(id);
  if (!existing) return null;
  if (name !== undefined) db.prepare("UPDATE api_clients SET name = ? WHERE id = ?").run(name, id);
  if (scopes !== undefined) {
    db.prepare("UPDATE api_clients SET scopes = ? WHERE id = ?").run(JSON.stringify(scopes), id);
  }
  if (publishMode !== undefined) {
    db.prepare("UPDATE api_clients SET publish_mode = ? WHERE id = ?").run(publishMode, id);
  }
  if (rateLimitPerMin !== undefined) {
    db.prepare("UPDATE api_clients SET rate_limit_per_min = ? WHERE id = ?").run(rateLimitPerMin, id);
  }
  return getApiClient(id);
}

export function hasScope(client, scope) {
  return Boolean(client && (client.scopes.includes(scope) || client.scopes.includes("*")));
}

export function findIdempotentResponse(clientId, key, method, path) {
  return (
    getDb()
      .prepare(
        "SELECT * FROM idempotency_keys WHERE client_id = ? AND idem_key = ? AND method = ? AND path = ?",
      )
      .get(clientId, key, method, path) || null
  );
}

export function saveIdempotentResponse(clientId, key, { method, path, requestHash, statusCode, body }) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO idempotency_keys
        (client_id, idem_key, method, path, request_hash, status_code, response_body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(clientId, key, method, path, requestHash, statusCode, body, nowIso());
}

export function cleanupIdempotency(days = 7) {
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
  return getDb().prepare("DELETE FROM idempotency_keys WHERE created_at < ?").run(cutoff).changes;
}
