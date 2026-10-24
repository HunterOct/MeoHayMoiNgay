import { HttpError } from "../lib/errors.js";
import { clientIp } from "./security.js";

/**
 * Fixed-window in-memory limiter. Suitable for a single Node instance;
 * put a CDN/WAF token bucket in front for multi-instance deployments.
 */
export function createRateLimiter({
  windowMs = 60_000,
  max = 120,
  prefix = "rl",
  skip = () => false,
  keyFn = (req) => clientIp(req),
  message = "Bạn truy cập quá nhanh, vui lòng thử lại sau.",
  onLimit = null,
} = {}) {
  const buckets = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  timer.unref?.();

  return function rateLimiter(req, res, next) {
    if (skip(req)) return next();
    const key = `${prefix}:${keyFn(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs, warned: false };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      if (!bucket.warned) {
        bucket.warned = true;
        onLimit?.(req, bucket.count);
      }
      return next(new HttpError(429, message, { code: "rate_limited" }));
    }
    next();
  };
}

/** Simple anti-enumeration tracker for sequential article reads. */
export function createEnumerationGuard({
  windowMs = 5 * 60_000,
  max = 40,
  blockMs = 10 * 60_000,
  onLimit = null,
} = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.blockedUntil < now && entry.stamps.every((s) => s < now - windowMs)) hits.delete(key);
    }
  }, 60_000);
  timer.unref?.();

  return function enumerationGuard(req, res, next) {
    if (req.isVerifiedBot) return next();
    const key = clientIp(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry) {
      entry = { stamps: [], blockedUntil: 0 };
      hits.set(key, entry);
    }
    if (entry.blockedUntil > now) {
      res.setHeader("Retry-After", String(Math.ceil((entry.blockedUntil - now) / 1000)));
      return next(
        new HttpError(429, "Truy cập bất thường bị tạm giới hạn.", { code: "enumeration_limited" }),
      );
    }
    entry.stamps = entry.stamps.filter((stamp) => stamp > now - windowMs);
    entry.stamps.push(now);
    if (entry.stamps.length > max) {
      entry.blockedUntil = now + blockMs;
      onLimit?.(req, entry.stamps.length);
      return next(
        new HttpError(429, "Truy cập bất thường bị tạm giới hạn.", { code: "enumeration_limited" }),
      );
    }
    next();
  };
}
