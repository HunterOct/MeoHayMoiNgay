import { config } from "../config.js";
import { findSession } from "../db/sessions.js";
import { timingSafeEqualString } from "../lib/passwords.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export function loadSession(req, res, next) {
  res.locals.user = null;
  res.locals.csrf = "";
  const token = req.cookies?.[config.sessionCookieName];
  if (token) {
    const session = findSession(token);
    if (session) {
      req.session = session;
      req.user = {
        id: session.user_id,
        email: session.email,
        name: session.name,
        role: session.role,
        bio: session.bio,
        is_active: session.is_active,
      };
      res.locals.user = req.user;
      res.locals.csrf = session.csrf_token;
    }
  }
  next();
}

export function setSessionCookie(res, token, expires) {
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
    expires: new Date(expires),
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
  });
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  const wantsJson = req.path.startsWith("/api") || req.accepts(["html", "json"]) === "json";
  if (wantsJson) return next(unauthorized());
  const nextUrl = encodeURIComponent(req.originalUrl || "/admin");
  return res.redirect(`/admin/login?next=${nextUrl}`);
}

export function requireAdmin(req, res, next) {
  if (!req.user) return requireUser(req, res, next);
  if (req.user.role !== "admin") return next(forbidden("Chỉ quản trị viên mới được thực hiện thao tác này"));
  next();
}

export function csrfProtection(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  // Multipart bodies are parsed by multer later; the route verifies the token
  // with verifyCsrfToken() after parsing.
  if (req.is("multipart/form-data")) return next();
  if (!req.user || !req.session) return next(forbidden("Phiên làm việc không hợp lệ, hãy đăng nhập lại"));
  const token = req.body?._csrf || req.get("x-csrf-token") || "";
  if (!token || !timingSafeEqualString(token, req.session.csrf_token)) {
    return next(forbidden("Phiên làm việc hết hạn hoặc token bảo vệ không đúng. Tải lại trang và thử lại."));
  }
  next();
}

export function verifyCsrfToken(req) {
  if (!req.session) return false;
  const token = req.body?._csrf || req.get("x-csrf-token") || "";
  return Boolean(token && timingSafeEqualString(token, req.session.csrf_token));
}
