import express from "express";
import { config, API_SCOPES } from "../../config.js";
import { getDb } from "../../db/index.js";
import { requireAdmin, clearSessionCookie } from "../../middleware/auth.js";
import { notFound } from "../../lib/errors.js";
import { passwordProblem } from "../../lib/passwords.js";
import {
  listUsers,
  createUser,
  updateUser,
  findById,
  setUserPassword,
} from "../../db/users.js";
import { destroyUserSessions } from "../../db/sessions.js";
import {
  listApiClients,
  createApiClient,
  updateApiClient,
  revokeApiClient,
  rotateApiKey,
  getApiClient,
} from "../../db/apikeys.js";
import { getSettings, setSettings, boolSetting } from "../../db/settings.js";
import { listAudit } from "../../db/audit.js";
import { logAudit } from "../../db/audit.js";
import { renderUsers } from "../../views/admin/users.js";
import { renderApiClients } from "../../views/admin/apikeys.js";
import { renderAudit } from "../../views/admin/audit.js";
import { renderSettings } from "../../views/admin/settings.js";

export const systemAdminRouter = express.Router();

systemAdminRouter.use(requireAdmin);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["admin", "editor", "author"]);

function audit(req, action, entityType, entityId, meta) {
  logAudit({
    actorType: "user",
    actorId: req.user.id,
    action,
    entityType,
    entityId,
    meta,
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  });
}

function uniqueError(error) {
  return /UNIQUE constraint failed/i.test(String(error?.message || ""));
}

function activeAdminCount() {
  return getDb()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1")
    .get().n;
}

/* ---------------- Users ---------------- */

systemAdminRouter.get("/users", (req, res) => {
  res.send(renderUsers(res.locals, listUsers()));
});

systemAdminRouter.post("/users", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = String(req.body.role || "author");
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 120 || !EMAIL_RE.test(email) || !ROLES.has(role)) {
      return res.redirect("/admin/users?err=invalid");
    }
    const problem = passwordProblem(password);
    if (problem) return res.redirect("/admin/users?err=password_weak");
    const user = await createUser({ email, password, name, role });
    audit(req, "user.created", "user", user.id, { email: user.email, role: user.role });
    return res.redirect("/admin/users?msg=user_created");
  } catch (error) {
    if (uniqueError(error)) return res.redirect("/admin/users?err=email_taken");
    return next(error);
  }
});

systemAdminRouter.post("/users/:id", async (req, res, next) => {
  try {
    const target = findById(req.params.id);
    if (!target) throw notFound("Tài khoản không tồn tại");
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = String(req.body.role || target.role);
    const isActive = req.body.is_active === "1" ? 1 : 0;
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 120 || !EMAIL_RE.test(email) || !ROLES.has(role)) {
      return res.redirect("/admin/users?err=invalid");
    }
    const isSelf = target.id === req.user.id;
    if (isSelf && (role !== "admin" || isActive !== 1)) {
      return res.redirect("/admin/users?err=admin_self");
    }
    if (target.role === "admin" && (role !== "admin" || isActive !== 1) && activeAdminCount() <= 1) {
      return res.redirect("/admin/users?err=last_admin");
    }
    if (password) {
      const problem = passwordProblem(password);
      if (problem) return res.redirect("/admin/users?err=password_weak");
    }
    updateUser(target.id, { name, email, role, is_active: isActive });
    let passwordChanged = false;
    if (password) {
      await setUserPassword(target.id, password);
      passwordChanged = true;
    }
    if (passwordChanged || !isActive) destroyUserSessions(target.id);
    audit(req, passwordChanged ? "user.password_reset" : "user.updated", "user", target.id, {
      email,
      role,
      is_active: isActive,
    });
    if (passwordChanged && isSelf) {
      clearSessionCookie(res);
      return res.redirect("/admin/login");
    }
    return res.redirect(`/admin/users?msg=${passwordChanged ? "password_reset" : "user_updated"}`);
  } catch (error) {
    if (uniqueError(error)) return res.redirect("/admin/users?err=email_taken");
    return next(error);
  }
});

/* ---------------- API clients ---------------- */

function parseScopes(body) {
  const raw = body.scopes;
  const list = raw === undefined ? [] : [].concat(raw).map(String);
  return [...new Set(list.filter((scope) => API_SCOPES.includes(scope)))];
}

function apiBase() {
  return `${config.siteUrl}/api/v1`;
}

systemAdminRouter.get("/api-clients", (req, res) => {
  res.send(
    renderApiClients(res.locals, {
      clients: listApiClients(),
      apiBase: apiBase(),
    }),
  );
});

systemAdminRouter.post("/api-clients", (req, res) => {
  const name = String(req.body.name || "").trim();
  const scopes = parseScopes(req.body);
  const publishMode = req.body.publish_mode === "auto" ? "auto" : "review";
  const rate = Math.min(600, Math.max(10, Number(req.body.rate_limit_per_min) || 60));
  if (name.length < 2 || name.length > 120 || !scopes.length) {
    return res.redirect("/admin/api-clients?err=invalid");
  }
  const { client, key } = createApiClient({ name, scopes, publishMode, rateLimitPerMin: rate });
  audit(req, "apikey.created", "api_client", client.id, { name, scopes, publishMode });
  res.send(
    renderApiClients(res.locals, {
      clients: listApiClients(),
      apiBase: apiBase(),
      newKey: { name: client.name, key },
    }),
  );
});

systemAdminRouter.post("/api-clients/:id", (req, res, next) => {
  try {
    const client = getApiClient(req.params.id);
    if (!client) throw notFound("API client không tồn tại");
    const name = String(req.body.name || "").trim();
    const scopes = parseScopes(req.body);
    const publishMode = req.body.publish_mode === "auto" ? "auto" : "review";
    const rate = Math.min(600, Math.max(10, Number(req.body.rate_limit_per_min) || 60));
    if (name.length < 2 || !scopes.length) return res.redirect("/admin/api-clients?err=invalid");
    updateApiClient(client.id, { name, scopes, publishMode, rateLimitPerMin: rate });
    audit(req, "apikey.updated", "api_client", client.id, { name, scopes, publishMode, rate });
    res.redirect("/admin/api-clients?msg=client_updated");
  } catch (error) {
    next(error);
  }
});

systemAdminRouter.post("/api-clients/:id/revoke", (req, res, next) => {
  try {
    const client = getApiClient(req.params.id);
    if (!client) throw notFound("API client không tồn tại");
    revokeApiClient(client.id);
    audit(req, "apikey.revoked", "api_client", client.id, { name: client.name });
    res.redirect("/admin/api-clients?msg=client_revoked");
  } catch (error) {
    next(error);
  }
});

systemAdminRouter.post("/api-clients/:id/rotate", (req, res, next) => {
  try {
    const result = rotateApiKey(req.params.id);
    if (!result) throw notFound("API client không tồn tại");
    audit(req, "apikey.rotated", "api_client", result.client.id, { name: result.client.name });
    res.send(
      renderApiClients(res.locals, {
        clients: listApiClients(),
        apiBase: apiBase(),
        newKey: { name: result.client.name, key: result.key },
      }),
    );
  } catch (error) {
    next(error);
  }
});

/* ---------------- Audit ---------------- */

systemAdminRouter.get("/audit", (req, res) => {
  const scope = req.query.scope === "security" ? "security" : "all";
  const action = String(req.query.action || "").slice(0, 100);
  const actor = String(req.query.actor || "");
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 40;
  const queryAction = action || (scope === "security" ? "security." : "");
  const result = listAudit({
    action: queryAction,
    actorType: ["user", "api", "system"].includes(actor) ? actor : "",
    limit: perPage,
    offset: (page - 1) * perPage,
  });
  res.send(
    renderAudit(res.locals, {
      rows: result.rows,
      total: result.total,
      page,
      totalPages: Math.max(1, Math.ceil(result.total / perPage)),
      filters: { action, actor },
      scope,
    }),
  );
});

/* ---------------- Settings ---------------- */

systemAdminRouter.get("/settings", (req, res) => {
  const users = listUsers().filter((user) => user.is_active);
  let dbVersion = "";
  let schemaVersion = 0;
  try {
    dbVersion = getDb().prepare("SELECT sqlite_version() AS v").get().v;
    schemaVersion = getDb().pragma("user_version", { simple: true });
  } catch {
    // Info panel only; failure should not block settings.
  }
  res.send(
    renderSettings(res.locals, {
      settings: getSettings(),
      users,
      info: {
        siteUrl: config.siteUrl,
        nodeEnv: config.nodeEnv,
        nodeVersion: process.version,
        dbVersion,
        schemaVersion,
        dbPath: config.dbPath,
        uploadDir: config.uploadDir,
        blockAi: config.blockAiCrawlers && !boolSetting("allow_ai_crawlers"),
        secureCookies: config.secureCookies,
      },
    }),
  );
});

systemAdminRouter.post("/settings", (req, res) => {
  const siteName = String(req.body.site_name || "").trim();
  const tagline = String(req.body.site_tagline || "").trim();
  const description = String(req.body.site_description || "").trim();
  const contact = String(req.body.contact_email || "").trim();
  const defaultAuthor = String(req.body.default_author_id || "").trim();
  if (siteName.length < 2 || siteName.length > 80) return res.redirect("/admin/settings?err=invalid");
  if (tagline.length > 160 || description.length > 320) return res.redirect("/admin/settings?err=invalid");
  if (contact && !EMAIL_RE.test(contact)) return res.redirect("/admin/settings?err=invalid");
  if (defaultAuthor && !findById(defaultAuthor)) return res.redirect("/admin/settings?err=invalid");
  setSettings({
    site_name: siteName,
    site_tagline: tagline,
    site_description: description,
    contact_email: contact,
    social_twitter: String(req.body.social_twitter || "").trim().slice(0, 120),
    social_facebook: String(req.body.social_facebook || "").trim().slice(0, 200),
    default_author_id: defaultAuthor,
    copyright: String(req.body.copyright || "").trim().slice(0, 400),
    allow_ai_crawlers: req.body.allow_ai_crawlers === "1" ? "1" : "0",
  });
  audit(req, "settings.updated", "settings", null, { keys: Object.keys(req.body).filter((key) => key !== "_csrf") });
  res.redirect("/admin/settings?msg=settings_saved");
});

