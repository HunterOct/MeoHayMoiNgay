import express from "express";
import crypto from "node:crypto";
import { config } from "../../config.js";
import { getSettings } from "../../db/settings.js";
import { findByEmailWithHash, markLoginSuccess, registerFailedLogin, isLocked } from "../../db/users.js";
import { createSession, destroySession, recordLoginAttempt } from "../../db/sessions.js";
import { setSessionCookie, clearSessionCookie, requireUser, csrfProtection } from "../../middleware/auth.js";
import { hashPassword, verifyPassword, timingSafeEqualString, randomToken } from "../../lib/passwords.js";
import { logAudit } from "../../db/audit.js";
import { createRateLimiter } from "../../middleware/rate-limit.js";
import { notFound } from "../../lib/errors.js";
import { countByStatus, countByStatusForAuthor, listAdmin, listUpcoming } from "../../db/posts.js";
import { countMedia } from "../../db/media.js";
import { countUsers } from "../../db/users.js";
import { listApiClients } from "../../db/apikeys.js";
import { listAudit, recentSecurityEvents, countSecurityEventsSince } from "../../db/audit.js";
import { renderLogin } from "../../views/admin/login.js";
import { renderDashboard } from "../../views/admin/dashboard.js";
import { flashFromQuery } from "../../views/admin/ui.js";
import { postsRouter } from "./posts.js";
import { mediaAdminRouter } from "./media.js";
import { taxonomyAdminRouter } from "./taxonomy.js";
import { systemAdminRouter } from "./system.js";

const DUMMY_HASH = await hashPassword(randomToken(16));
const LOGIN_CSRF_COOKIE = "mh_login_csrf";

export const adminRouter = express.Router();

adminRouter.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  res.locals.settings = getSettings();
  res.locals.flash = null;
  res.locals.isAdmin = true;
  next();
});

function safeNext(value) {
  const target = String(value || "");
  return target.startsWith("/admin") && !target.startsWith("//") ? target : "/admin";
}

function loginCsrf(req, res) {
  const cookie = req.cookies?.[LOGIN_CSRF_COOKIE];
  if (cookie) return cookie;
  const token = crypto.randomBytes(24).toString("base64url");
  res.cookie(LOGIN_CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/admin",
    maxAge: 60 * 60 * 1000,
  });
  return token;
}

function sendLogin(req, res, { error = "", next = "", status = 200 } = {}) {
  res.locals.nonce = res.locals.nonce || crypto.randomBytes(16).toString("base64");
  return res.status(status).send(
    renderLogin(res.locals, {
      csrf: loginCsrf(req, res),
      error,
      next: safeNext(next || req.query.next || req.body?.next),
    }),
  );
}

adminRouter.get("/login", (req, res) => {
  if (req.user) return res.redirect("/admin");
  return sendLogin(req, res, { error: req.query.err || "", next: req.query.next });
});

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  prefix: "login",
  message: "Quá nhiều lần đăng nhập.",
  onLimit: (req) => {
    logAudit({
      actorType: "system",
      action: "security.login_rate_limited",
      meta: { email: String(req.body?.email || "").slice(0, 120) },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
  },
});

function loginLimit(req, res, next) {
  loginLimiter(req, res, (error) => {
    if (error) return sendLogin(req, res, { error: "rate", status: 429, next: req.body?.next });
    next();
  });
}

adminRouter.post("/login", loginLimit, async (req, res, next) => {
  try {
    const cookie = req.cookies?.[LOGIN_CSRF_COOKIE];
    const token = String(req.body?._csrf || "");
    if (!cookie || !token || !timingSafeEqualString(cookie, token)) {
      return sendLogin(req, res, { error: "csrf" });
    }
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    if (!email || !password) return sendLogin(req, res, { error: "invalid", next: req.body?.next });

    const user = findByEmailWithHash(email);
    if (!user) {
      await verifyPassword(password, DUMMY_HASH);
      recordLoginAttempt(email, req.ip, false);
      return sendLogin(req, res, { error: "credentials", next: req.body?.next });
    }
    if (!user.is_active) {
      recordLoginAttempt(email, req.ip, false);
      return sendLogin(req, res, { error: "credentials", next: req.body?.next });
    }
    if (isLocked(user)) {
      recordLoginAttempt(email, req.ip, false);
      logAudit({
        actorType: "user",
        actorId: user.id,
        action: "auth.login_locked",
        ip: req.ip,
        userAgent: req.get("user-agent") || "",
      });
      return sendLogin(req, res, { error: "locked", next: req.body?.next });
    }
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      registerFailedLogin(user.id);
      recordLoginAttempt(email, req.ip, false);
      logAudit({
        actorType: "user",
        actorId: user.id,
        action: "auth.login_failed",
        ip: req.ip,
        userAgent: req.get("user-agent") || "",
      });
      return sendLogin(req, res, { error: "credentials", next: req.body?.next });
    }

    const previousToken = req.cookies?.[config.sessionCookieName];
    if (previousToken) destroySession(previousToken);
    const session = createSession(user.id, { ip: req.ip, userAgent: req.get("user-agent") || "" });
    setSessionCookie(res, session.token, session.expires);
    markLoginSuccess(user.id);
    recordLoginAttempt(email, req.ip, true);
    logAudit({
      actorType: "user",
      actorId: user.id,
      action: "auth.login",
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return res.redirect(safeNext(req.body?.next));
  } catch (error) {
    next(error);
  }
});

adminRouter.use(requireUser);
adminRouter.use(csrfProtection);

adminRouter.use((req, res, next) => {
  res.locals.flash = flashFromQuery(req.query);
  res.locals.adminCounts =
    req.user.role === "author" ? countByStatusForAuthor(req.user.id) : countByStatus();
  res.locals.timezoneLabel = config.timezone;
  res.locals.maxUploadMb = config.maxUploadMb;
  next();
});

adminRouter.post("/logout", (req, res) => {
  const token = req.cookies?.[config.sessionCookieName];
  if (token) destroySession(token);
  clearSessionCookie(res);
  logAudit({
    actorType: "user",
    actorId: req.user.id,
    action: "auth.logout",
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  });
  res.redirect("/admin/login?msg=logged_out");
});

adminRouter.get("/", (req, res) => {
  const isAuthor = req.user.role === "author";
  const authorId = isAuthor ? req.user.id : "";
  const data = {
    recent: listAdmin({ authorId, perPage: 5, page: 1 }).items,
    upcoming: listUpcoming(5, { authorId: isAuthor ? req.user.id : null }),
    mediaCount: countMedia(),
    userCount: countUsers(),
    clientCount: listApiClients().length,
    audit: [],
    securityEvents: [],
    securityCount24h: 0,
  };
  if (req.user.role === "admin") {
    data.audit = listAudit({ limit: 8 }).rows;
    data.securityEvents = recentSecurityEvents(5);
    data.securityCount24h = countSecurityEventsSince(
      new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    );
  }
  res.send(renderDashboard(res.locals, data));
});

adminRouter.use(postsRouter);
adminRouter.use(mediaAdminRouter);
adminRouter.use(taxonomyAdminRouter);
adminRouter.use(systemAdminRouter);

adminRouter.use((req, res, next) => next(notFound("Trang quản trị không tồn tại")));

