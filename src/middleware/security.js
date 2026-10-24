import crypto from "node:crypto";
import helmet from "helmet";
import { config } from "../config.js";

export function requestContext(req, res, next) {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  res.locals.path = req.path;
  res.locals.siteUrl = config.siteUrl;
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

export const helmetMiddleware = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  strictTransportSecurity: config.secureCookies
    ? { maxAge: 15552000, includeSubDomains: true, preload: false }
    : false,
});

export function contentSecurityPolicy(req, res, next) {
  const nonce = res.locals.nonce;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "media-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (config.secureCookies) directives.push("upgrade-insecure-requests");
  res.setHeader("Content-Security-Policy", directives.join("; "));
  next();
}

export function cacheControl(value) {
  return (req, res, next) => {
    res.setHeader("Cache-Control", value);
    next();
  };
}

export function originCheck(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  try {
    const originHost = new URL(origin).host;
    if (originHost !== req.get("host")) {
      return res.status(403).type("text/plain").send("Origin không hợp lệ");
    }
  } catch {
    return res.status(403).type("text/plain").send("Origin không hợp lệ");
  }
  next();
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function isPrivateIp(ip) {
  const value = String(ip || "").replace(/^::ffff:/, "");
  return (
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "localhost" ||
    /^10\./.test(value) ||
    /^192\.168\./.test(value) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value) ||
    /^fc00:/i.test(value) ||
    /^fe80:/i.test(value)
  );
}
