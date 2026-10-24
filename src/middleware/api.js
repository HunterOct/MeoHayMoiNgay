import { verifyApiKey, hasScope, findIdempotentResponse, saveIdempotentResponse } from "../db/apikeys.js";
import { getCategoryById, getCategoryBySlug } from "../db/taxonomy.js";
import { getSettings } from "../db/settings.js";
import { getDb } from "../db/index.js";
import { logAudit, logAuditThrottled } from "../db/audit.js";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../lib/errors.js";
import { sha256 } from "../lib/passwords.js";
import { slugify } from "../lib/slug.js";
import { config } from "../config.js";
import { createRateLimiter } from "./rate-limit.js";

export function apiHeaders(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}

export const apiIpLimit = createRateLimiter({
  windowMs: 60_000,
  max: 300,
  prefix: "api-ip",
  message: "Quá nhiều yêu cầu API từ địa chỉ này.",
  onLimit: (req) => {
    logAudit({
      actorType: "system",
      action: "security.api_ip_rate_limited",
      meta: { path: req.path },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
  },
});

export function preventKeyInQuery(req, res, next) {
  if (req.query.api_key || req.query.key || req.query.token) {
    return next(badRequest("Không gửi API key trong URL. Dùng header Authorization: Bearer <key>."));
  }
  next();
}

export function apiAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="mh-api"');
    return next(unauthorized("Thiếu Authorization: Bearer <key>."));
  }
  const client = verifyApiKey(match[1]);
  if (!client) {
    logAuditThrottled({
      actorType: "system",
      action: "security.api_auth_failed",
      meta: { key_prefix: match[1].slice(0, 12), path: req.path },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    res.setHeader("WWW-Authenticate", 'Bearer realm="mh-api", error="invalid_token"');
    return next(unauthorized("API key không hợp lệ hoặc đã bị thu hồi."));
  }
  req.apiClient = client;
  res.locals.apiClient = client;
  next();
}

export function requireScope(scope) {
  return (req, res, next) => {
    if (!hasScope(req.apiClient, scope)) {
      return next(forbidden(`API key thiếu quyền ${scope}.`));
    }
    next();
  };
}

export function requireAnyScope(scopes) {
  return (req, res, next) => {
    if (!scopes.some((scope) => hasScope(req.apiClient, scope))) {
      return next(forbidden(`API key thiếu quyền. Cần một trong: ${scopes.join(", ")}.`));
    }
    next();
  };
}

const clientBuckets = new Map();
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of clientBuckets) {
    if (bucket.resetAt <= now) clientBuckets.delete(key);
  }
}, 60_000);
cleanupTimer.unref?.();

export function clientRateLimit(req, res, next) {
  const client = req.apiClient;
  if (!client) return next(unauthorized());
  const max = Math.min(600, Math.max(10, client.rate_limit_per_min || config.rateLimitApiPerMin));
  const now = Date.now();
  let bucket = clientBuckets.get(client.id);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + 60_000, warned: false };
    clientBuckets.set(client.id, bucket);
  }
  bucket.count += 1;
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > max) {
    const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retry));
    if (!bucket.warned) {
      bucket.warned = true;
      logAudit({
        actorType: "api",
        actorId: client.id,
        action: "security.api_rate_limited",
        meta: { limit: max, path: req.path },
        ip: req.ip,
        userAgent: req.get("user-agent") || "",
      });
    }
    return next(tooManyRequests("API key vượt quá giới hạn request/phút."));
  }
  next();
}

export function beginIdempotency(req) {
  const key = String(req.get("idempotency-key") || "").trim();
  if (!key) return null;
  if (key.length > 200 || !/^[\x20-\x7E]+$/.test(key)) {
    throw badRequest("Idempotency-Key không hợp lệ (tối đa 200 ký tự ASCII).");
  }
  const path = `${req.baseUrl}${req.path}`;
  const requestHash = sha256(JSON.stringify(req.body || {}));
  const existing = findIdempotentResponse(req.apiClient.id, key, req.method, path);
  return { key, path, requestHash, existing };
}

export function replayIdempotent(res, state) {
  if (!state || !state.existing) return false;
  if (state.existing.request_hash !== state.requestHash) {
    throw conflict("Idempotency-Key đã được dùng với nội dung khác.", {
      code: "idempotency_conflict",
      existing_request: "stored",
    });
  }
  res.setHeader("Idempotent-Replayed", "true");
  res.status(state.existing.status_code).type("application/json").send(state.existing.response_body);
  return true;
}

export function storeIdempotent(req, state, statusCode, payload) {
  if (!state || !state.key) return;
  saveIdempotentResponse(req.apiClient.id, state.key, {
    method: req.method,
    path: state.path,
    requestHash: state.requestHash,
    statusCode,
    body: JSON.stringify(payload),
  });
}

export function parseDate(value, { future = false, field = "scheduled_at" } = {}) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`${field} không phải thời gian hợp lệ (dùng ISO 8601).`, {
      code: "validation_error",
      details: [{ path: field, message: "Định dạng thời gian không hợp lệ." }],
    });
  }
  if (future && date.getTime() <= Date.now() + 30_000) {
    throw badRequest(`${field} phải ở tương lai.`, {
      code: "validation_error",
      details: [{ path: field, message: "Thời điểm phải trong tương lai." }],
    });
  }
  return date.toISOString();
}

export function resolveRequestedStatus(client, requested, { scheduledAt = null } = {}) {
  if (!requested) return { status: null, demoted: false, scheduledAt };
  if (["published", "scheduled"].includes(requested)) {
    if (client.publish_mode === "review") {
      return { status: "review", demoted: true, scheduledAt: null };
    }
    if (!hasScope(client, "posts:publish")) {
      throw forbidden("API key thiếu quyền posts:publish để xuất bản.");
    }
    if (requested === "scheduled" && !scheduledAt) {
      throw badRequest("scheduled_at là bắt buộc khi status=scheduled.", {
        code: "validation_error",
        details: [{ path: "scheduled_at", message: "Thiếu thời điểm xuất bản." }],
      });
    }
    return { status: requested, demoted: false, scheduledAt: requested === "scheduled" ? scheduledAt : null };
  }
  if (requested === "archived") {
    if (!hasScope(client, "posts:publish")) {
      throw forbidden("API key thiếu quyền posts:publish để lưu trữ bài.");
    }
    if (client.publish_mode === "review") {
      throw forbidden("Client ở chế độ chờ duyệt không thể lưu trữ bài đã đăng.");
    }
  }
  return { status: requested, demoted: false, scheduledAt: null };
}

export function resolveCategory(value) {
  if (!value) return null;
  const byId = getCategoryById(value);
  if (byId) return byId;
  const bySlug = getCategoryBySlug(slugify(value));
  if (bySlug) return bySlug;
  throw badRequest("Chuyên mục không tồn tại.", {
    code: "validation_error",
    details: [{ path: "category", message: `Không tìm thấy chuyên mục “${value}”.` }],
  });
}

export function defaultAuthorId() {
  const settings = getSettings();
  if (settings.default_author_id) {
    const user = getDb()
      .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1")
      .get(settings.default_author_id);
    if (user) return user.id;
  }
  const admin = getDb()
    .prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY created_at ASC LIMIT 1")
    .get();
  if (admin) return admin.id;
  const anyUser = getDb().prepare("SELECT id FROM users WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1").get();
  return anyUser?.id || null;
}

export function apiAudit(req, action, entityId, meta = {}) {
  logAudit({
    actorType: "api",
    actorId: req.apiClient.id,
    action,
    entityType: "post",
    entityId,
    meta,
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  });
}
