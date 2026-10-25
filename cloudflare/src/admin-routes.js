import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { config } from "./config.js";
import { getSettings, setSettings } from "./settings.js";
import { randomToken, timingSafeEqual } from "./token.js";
import { SITE } from "./config.js";
import { IMAGE_DIMENSIONS } from "./lib/image-dimensions.js";
import { canEditPost, canManageTaxonomy, canPurge, canPublish, STATUS_LABELS } from "./lib/permissions.js";
import { fromLocalInput, formatDateTime } from "./lib/time.js";
import * as data from "./admin-data.js";
import { renderAdminError } from "./views/admin/error.js";
import { renderLogin } from "./views/admin/login.js";
import { renderDashboard } from "./views/admin/dashboard.js";
import { renderPosts } from "./views/admin/posts.js";
import { renderEditor } from "./views/admin/editor.js";
import { renderRevisions } from "./views/admin/revisions.js";
import { renderCategories, renderTags } from "./views/admin/taxonomy.js";
import { renderUsers } from "./views/admin/users.js";
import { renderApiClients } from "./views/admin/apikeys.js";
import { renderAudit } from "./views/admin/audit.js";
import { renderSettings } from "./views/admin/settings.js";
import { renderMedia } from "./views/admin/media.js";
import { mediaEnabled } from "./media.js";
import { deleteMediaById, uploadMedia } from "./media-service.js";
import { renderArticle } from "./views/article.js";
import { flashFromQuery } from "./views/admin/ui.js";
import { adjacentPosts, listCategoriesFast, listLatest, listRelated } from "./public-data.js";
import { applyNoStore, applySecurityHeaders, newNonce } from "./security.js";

const SESSION_COOKIE = "mh_session";
const LOGIN_CSRF_COOKIE = "mh_login_csrf";
const SESSION_MAX_AGE = 7 * 24 * 3600;
const MAX_UPLOAD_MB = 8;
const SCOPES = ["posts:read", "posts:write", "posts:publish", "media:write", "taxonomy:read"];
const dashboardCache = new Map();
const DASHBOARD_CACHE_MS = 10_000;

const DUMMY_HASH =
  "scrypt$16384$8$1$zGereTJRZ0C2CL5YHnLeXA==$u65BDfT+RAxECqI/wYTTpJR19hcuqbrU1TQ2sWNimLxpYfvKfs1B2skE4ZAz0a5wrwSzM5M8iu8RadY1Sx31rQ==";

function doStub(c, name) {
  return c.env.SECURE_OPS.get(c.env.SECURE_OPS.idFromName(name));
}

function clientIp(c) {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
}

function userAgent(c) {
  return c.req.header("user-agent") || "";
}

function safeNext(value) {
  const target = String(value || "");
  return target.startsWith("/admin") && !target.startsWith("//") ? target : "/admin";
}

function first(form, key) {
  const value = form?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function listValue(form, key) {
  const value = form?.[key];
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function formObject(c) {
  return c.get("form") || {};
}

function passwordProblem(password) {
  const value = String(password || "");
  if (value.length < 10) return "Mật khẩu cần tối thiểu 10 ký tự.";
  if (value.length > 200) return "Mật khẩu quá dài.";
  if (/^[a-zA-Z]+$/.test(value) || /^\d+$/.test(value)) return "Mật khẩu cần có cả chữ và số.";
  return null;
}

function validImageUrl(value) {
  if (!value) return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validCanonicalUrl(value) {
  if (!value) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function statusForAction(action, existing) {
  const map = {
    save: existing?.status || "draft",
    draft: "draft",
    review: "review",
    publish: "published",
    schedule: "scheduled",
    archive: "archived",
  };
  return map[action] || "draft";
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 90)
    .replace(/-+$/g, "");
}

async function parseForm(c) {
  const contentType = c.req.header("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    return {};
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await c.req.text().catch(() => ""));
    const form = {};
    for (const [key, value] of params) {
      if (!(key in form)) form[key] = value;
      else form[key] = Array.isArray(form[key]) ? [...form[key], value] : [form[key], value];
    }
    return form;
  }
  return c.req.parseBody().catch(() => ({}));
}

async function adminContext(c, session) {
  const settings = await getSettings(c.env.DB);
  const adminCounts = await data.countByStatusAdmin(
    c.env.DB,
    session.role === "author" ? session.user_id : "",
  );
  const url = new URL(c.req.url);
  const flash = flashFromQuery(Object.fromEntries(url.searchParams.entries()));
  return {
    settings,
    chrome: null,
    user: {
      id: session.user_id,
      email: session.email,
      name: session.name,
      role: session.role,
      bio: session.bio,
      is_active: session.is_active,
    },
    csrf: session.csrf_token,
    adminCounts,
    flash,
    nonce: newNonce(),
    timezoneLabel: config.timezone,
    maxUploadMb: MAX_UPLOAD_MB,
    mediaUploadEnabled: mediaEnabled(c.env),
    path: url.pathname,
  };
}

function sendAdmin(c, ctx, html, status = 200) {
  applySecurityHeaders(c, ctx.nonce || newNonce());
  applyNoStore(c);
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.html(html, status);
}

async function adminError(c, status, title, message) {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await data.findAdminSession(c.env.DB, token) : null;
  const settings = await getSettings(c.env.DB);
  const nonce = newNonce();
  applySecurityHeaders(c, nonce);
  applyNoStore(c);
  c.header("X-Robots-Tag", "noindex, nofollow");
  const ctx = session
    ? {
        settings,
        user: {
          id: session.user_id,
          email: session.email,
          name: session.name,
          role: session.role,
          bio: session.bio,
          is_active: session.is_active,
        },
        csrf: session.csrf_token,
        adminCounts: { draft: 0, review: 0, scheduled: 0, published: 0, archived: 0, trash: 0, total: 0 },
        flash: null,
        nonce,
        timezoneLabel: config.timezone,
        maxUploadMb: MAX_UPLOAD_MB,
        mediaUploadEnabled: mediaEnabled(c.env),
      }
    : { settings, user: null, csrf: "", flash: null, nonce };
  return c.html(renderAdminError(ctx, { status, title, message }), status);
}

function loginResponse(c, ctx, { csrf, error = "", next = "" } = {}, status = 200) {
  applySecurityHeaders(c, ctx.nonce);
  applyNoStore(c);
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.html(renderLogin(ctx, { csrf, error, next }), status);
}

async function setLoginCsrfCookie(c) {
  let token = getCookie(c, LOGIN_CSRF_COOKIE);
  if (!token) {
    token = randomToken(24);
    setCookie(c, LOGIN_CSRF_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.secureCookies,
      path: "/admin",
      maxAge: 3600,
    });
  }
  return token;
}

async function loginPage(c, { error = "", next = "" } = {}, status = 200) {
  const settings = await getSettings(c.env.DB);
  const ctx = { settings, user: null, nonce: newNonce(), csrf: "" };
  const csrf = await setLoginCsrfCookie(c);
  return loginResponse(c, ctx, { csrf, error, next }, status);
}

function parsePostForm(form, existing, user, categories, users, action) {
  const values = {
    ...(existing || {}),
    title: String(first(form, "title") || "").trim(),
    slug: String(first(form, "slug") || "").trim(),
    excerpt: String(first(form, "excerpt") || "").trim(),
    lede: String(first(form, "lede") || "").trim(),
    content_source: String(first(form, "content") || ""),
    content_format: first(form, "content_format") === "html" ? "html" : "markdown",
    status: existing?.status || "draft",
    category_id: String(first(form, "category_id") || ""),
    author_id: user.role === "author" ? existing?.author_id || user.id : String(first(form, "author_id") || user.id),
    cover_image: String(first(form, "cover_image") || "").trim(),
    cover_alt: String(first(form, "cover_alt") || "").trim(),
    cover_caption: String(first(form, "cover_caption") || "").trim(),
    seo_title: String(first(form, "seo_title") || "").trim(),
    seo_description: String(first(form, "seo_description") || "").trim(),
    focus_keyword: String(first(form, "focus_keyword") || "").trim(),
    canonical_url: String(first(form, "canonical_url") || "").trim(),
    og_image: String(first(form, "og_image") || "").trim(),
    is_featured: first(form, "is_featured") === "1",
    read_minutes: first(form, "read_minutes") ? Number(first(form, "read_minutes")) : existing?.read_minutes || null,
    tags: String(first(form, "tags") || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8),
  };
  const scheduledRaw = String(first(form, "scheduled_at_input") || "").trim();
  const scheduledAt = scheduledRaw ? fromLocalInput(scheduledRaw) : null;
  const errors = [];
  if (values.title.length < 3) errors.push("Tiêu đề cần tối thiểu 3 ký tự.");
  if (values.title.length > 200) errors.push("Tiêu đề tối đa 200 ký tự.");
  if (values.excerpt.length > 500) errors.push("Mô tả ngắn tối đa 500 ký tự.");
  if (values.lede.length > 600) errors.push("Đoạn mở đầu tối đa 600 ký tự.");
  if (values.content_source.length > 200_000) errors.push("Nội dung quá dài (tối đa 200.000 ký tự).");
  if (values.seo_title.length > 80) errors.push("SEO title tối đa 80 ký tự.");
  if (values.seo_description.length > 220) errors.push("Meta description tối đa 220 ký tự.");
  if (values.focus_keyword.length > 100) errors.push("Từ khóa chính tối đa 100 ký tự.");
  if (values.canonical_url.length > 300) errors.push("Canonical URL quá dài.");
  if (values.tags.some((tag) => tag.length > 60)) errors.push("Mỗi thẻ tối đa 60 ký tự.");
  if (values.category_id && !categories.some((category) => category.id === values.category_id)) {
    errors.push("Chuyên mục không hợp lệ.");
  }
  if (user.role !== "author" && !users.some((entry) => entry.id === values.author_id && entry.is_active)) {
    errors.push("Tác giả không hợp lệ.");
  }
  if (!validImageUrl(values.cover_image)) errors.push("Ảnh đại diện phải là HTTPS hoặc đường dẫn nội bộ.");
  if (!validImageUrl(values.og_image)) errors.push("Ảnh OG phải là HTTPS hoặc đường dẫn nội bộ.");
  if (!validCanonicalUrl(values.canonical_url)) errors.push("Canonical URL phải là HTTPS.");
  if (values.read_minutes && (Number.isNaN(values.read_minutes) || values.read_minutes < 1 || values.read_minutes > 120)) {
    errors.push("Thời gian đọc phải từ 1 đến 120 phút.");
  }
  if (scheduledRaw && !scheduledAt) errors.push("Thời điểm lên lịch không hợp lệ.");
  if (action === "schedule") {
    if (!scheduledAt) errors.push("Vui lòng chọn thời điểm xuất bản.");
    else if (new Date(scheduledAt).getTime() <= Date.now()) errors.push("Thời điểm lên lịch phải ở tương lai.");
  }
  return { values, scheduledAt, error: errors[0] || "" };
}

async function sanitizeForAdmin(c, source, format) {
  const stub = doStub(c, "sanitize");
  const result = await stub.sanitize(source, format === "markdown" ? "markdown" : "html");
  return result.html;
}

function postDataFromValues(values, html, scheduledAt) {
  return {
    title: values.title,
    slug: values.slug,
    excerpt: values.excerpt,
    lede: values.lede,
    contentHtml: html,
    contentSource: values.content_source,
    contentFormat: values.content_format,
    status: values.status,
    categoryId: values.category_id || null,
    authorId: values.author_id,
    coverImage: values.cover_image,
    coverAlt: values.cover_alt,
    coverCaption: values.cover_caption,
    seoTitle: values.seo_title,
    seoDescription: values.seo_description,
    focusKeyword: values.focus_keyword,
    canonicalUrl: values.canonical_url,
    ogImage: values.og_image,
    isFeatured: values.is_featured,
    readMinutes: values.read_minutes || undefined,
    scheduledAt,
    tags: values.tags,
  };
}

async function editorPage(c, ctx, post, { isNew, error = "" }) {
  const categories = await data.listAdminCategories(c.env.DB);
  const users =
    ctx.user.role === "author"
      ? [await data.findUserById(c.env.DB, ctx.user.id)].filter(Boolean)
      : (await data.listAdminUsers(c.env.DB)).filter((entry) => entry.is_active);
  return sendAdmin(
    c,
    ctx,
    renderEditor(ctx, {
      post,
      isNew,
      categories,
      users,
      canPublish: canPublish(ctx.user),
      error,
    }),
  );
}

function listLegacyMedia() {
  return Object.entries(IMAGE_DIMENSIONS).map(([url, dims], index) => ({
    id: `legacy-${index + 1}`,
    filename: url.split("/").pop(),
    url,
    original_name: url.split("/").pop(),
    width: dims.width,
    height: dims.height,
    size: null,
    created_at: null,
    usage_count: 0,
    legacy: true,
    alt: "",
    provider: "static",
    status: "ready",
  }));
}

async function listDbMedia(c, q = "") {
  const params = [];
  let where = "";
  if (q) {
    where = "WHERE m.original_name LIKE ? OR m.alt LIKE ?";
    params.push(`%${q}%`, `%${q}%`);
  }
  const result = await c.env.DB
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM media_usages mu WHERE mu.media_id = m.id) AS usage_count
       FROM media m ${where} ORDER BY m.created_at DESC LIMIT 100`,
    )
    .bind(...params)
    .all();
  return result.results || [];
}

export function registerAdminRoutes(app) {
  app.get("/admin/login", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token && (await data.findAdminSession(c.env.DB, token))) return c.redirect("/admin", 302);
    return loginPage(c, { next: c.req.query("next") });
  });

  app.post("/admin/login", async (c) => {
    const form = await parseForm(c);
    const cookieToken = getCookie(c, LOGIN_CSRF_COOKIE);
    const provided = String(first(form, "_csrf") || "");
    if (!cookieToken || !provided || !timingSafeEqual(cookieToken, provided)) {
      return loginPage(c, { error: "csrf", next: first(form, "next") }, 403);
    }
    const ip = clientIp(c);
    const ua = userAgent(c);
    try {
      const limit = await doStub(c, "rate").rateLimit(`login:${ip}`, 15, 15 * 60_000);
      if (!limit.allowed) {
        await data.logAudit(c.env.DB, {
          actorType: "system",
          action: "security.login_rate_limited",
          meta: { email: String(first(form, "email") || "").slice(0, 120) },
          ip,
          userAgent: ua,
        });
        return loginPage(c, { error: "rate", next: first(form, "next") }, 429);
      }
      const email = String(first(form, "email") || "").trim();
      const password = String(first(form, "password") || "");
      if (!email || !password) return loginPage(c, { error: "invalid", next: first(form, "next") });
      const user = await data.findUserByEmail(c.env.DB, email);
      if (!user) {
        await doStub(c, "auth").verifyScrypt(password, DUMMY_HASH);
        await data.recordLoginAttempt(c.env.DB, email, ip, false);
        return loginPage(c, { error: "credentials", next: first(form, "next") });
      }
      if (!user.is_active) {
        await data.recordLoginAttempt(c.env.DB, email, ip, false);
        return loginPage(c, { error: "credentials", next: first(form, "next") });
      }
      if (data.isAccountLocked(user)) {
        await data.recordLoginAttempt(c.env.DB, email, ip, false);
        await data.logAudit(c.env.DB, {
          actorType: "user",
          actorId: user.id,
          action: "auth.login_locked",
          ip,
          userAgent: ua,
        });
        return loginPage(c, { error: "locked", next: first(form, "next") });
      }
      const verified = await doStub(c, "auth").verifyScrypt(password, user.password_hash);
      if (!verified.ok) {
        await data.registerFailedLogin(c.env.DB, user.id);
        await data.recordLoginAttempt(c.env.DB, email, ip, false);
        await data.logAudit(c.env.DB, {
          actorType: "user",
          actorId: user.id,
          action: "auth.login_failed",
          ip,
          userAgent: ua,
        });
        return loginPage(c, { error: "credentials", next: first(form, "next") });
      }
      const previous = getCookie(c, SESSION_COOKIE);
      if (previous) await data.destroyAdminSession(c.env.DB, previous);
      const session = await data.createAdminSession(c.env.DB, user.id, { ip, userAgent: ua });
      setCookie(c, SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.secureCookies,
        path: "/",
        maxAge: SESSION_MAX_AGE,
      });
      deleteCookie(c, LOGIN_CSRF_COOKIE, { path: "/admin" });
      await data.markLoginSuccess(c.env.DB, user.id);
      await data.recordLoginAttempt(c.env.DB, email, ip, true);
      await data.logAudit(c.env.DB, {
        actorType: "user",
        actorId: user.id,
        action: "auth.login",
        ip,
        userAgent: ua,
      });
      return c.redirect(safeNext(first(form, "next")), 302);
    } catch (error) {
      console.error("admin.login_failed", error);
      return loginPage(c, { error: "invalid", next: first(form, "next") }, 503);
    }
  });

  const authMiddleware = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? await data.findAdminSession(c.env.DB, token) : null;
    if (!session) {
      if (c.req.method === "GET") {
        const nextUrl = encodeURIComponent(c.req.path + (new URL(c.req.url).search || ""));
        return c.redirect(`/admin/login?next=${nextUrl}`, 302);
      }
      return adminError(c, 403, "Cần đăng nhập", "Phiên làm việc không hợp lệ hoặc đã hết hạn.");
    }
    session.id = session.user_id;
    c.set("adminSession", session);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) dashboardCache.clear();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin) {
        try {
          if (new URL(origin).host !== new URL(c.req.url).host) {
            return adminError(c, 403, "Origin không hợp lệ", "Yêu cầu thay đổi dữ liệu bị từ chối.");
          }
        } catch {
          return adminError(c, 403, "Origin không hợp lệ", "Yêu cầu thay đổi dữ liệu bị từ chối.");
        }
      }
      const form = await parseForm(c);
      c.set("form", form);
      const csrf = String(first(form, "_csrf") || c.req.header("x-csrf-token") || "");
      if (!csrf || !timingSafeEqual(csrf, session.csrf_token)) {
        return adminError(
          c,
          403,
          "Phiên làm việc hết hạn",
          "Token bảo vệ không đúng. Tải lại trang và thử lại.",
        );
      }
    }
    await next();
  };
  app.use("/admin", authMiddleware);
  app.use("/admin/*", authMiddleware);

  app.get("/admin", async (c) => {
    const session = c.get("adminSession");
    const ctx = await adminContext(c, session);
    const cacheKey = `${session.session_id}:${session.role}`;
    const cached = dashboardCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DASHBOARD_CACHE_MS) {
      return sendAdmin(c, ctx, renderDashboard(ctx, cached.payload));
    }
    const isAuthor = session.role === "author";
    const authorId = isAuthor ? session.user_id : "";
    const [recent, upcoming, userCount, clientCount] = await Promise.all([
      data.listAdminPosts(c.env.DB, { authorId, perPage: 5, page: 1 }),
      data.listUpcomingAdmin(c.env.DB, 5, { authorId: isAuthor ? session.user_id : null }),
      data.countUsers(c.env.DB),
      data.countApiClients(c.env.DB),
    ]);
    const payload = {
      recent: recent.items,
      upcoming,
      mediaCount: listLegacyMedia().length,
      userCount,
      clientCount,
      audit: [],
      securityEvents: [],
      securityCount24h: 0,
    };
    if (session.role === "admin") {
      payload.audit = (await data.listAuditRows(c.env.DB, { limit: 8 })).rows;
      payload.securityEvents = await data.recentSecurityEvents(c.env.DB, 5);
      payload.securityCount24h = await data.countSecurityEventsSince(
        c.env.DB,
        new Date(Date.now() - 24 * 3600_000).toISOString(),
      );
    }
    dashboardCache.set(cacheKey, { at: Date.now(), payload });
    if (dashboardCache.size > 50) dashboardCache.clear();
    return sendAdmin(c, ctx, renderDashboard(ctx, payload));
  });

  app.get("/admin/posts", async (c) => {
    const session = c.get("adminSession");
    const ctx = await adminContext(c, session);
    const filters = {
      status: String(c.req.query("status") || ""),
      q: String(c.req.query("q") || "").slice(0, 100),
      category: String(c.req.query("category") || ""),
      author: String(c.req.query("author") || ""),
    };
    const authorFilter = session.role === "author" ? session.user_id : filters.author;
    const result = await data.listAdminPosts(c.env.DB, {
      status: filters.status,
      q: filters.q,
      categoryId: filters.category,
      authorId: authorFilter,
      page: Number(c.req.query("page")) || 1,
      perPage: 20,
    });
    const categories = await data.listAdminCategories(c.env.DB);
    const users = await data.listAdminUsers(c.env.DB);
    return sendAdmin(
      c,
      ctx,
      renderPosts(ctx, {
        result,
        filters: { ...filters, author: authorFilter, page: c.req.query("page") },
        categories,
        users,
        canPublish: canPublish(session),
        trash: false,
      }),
    );
  });

  app.get("/admin/trash", async (c) => {
    const session = c.get("adminSession");
    const ctx = await adminContext(c, session);
    const filters = {
      q: String(c.req.query("q") || "").slice(0, 100),
      category: String(c.req.query("category") || ""),
      author: String(c.req.query("author") || ""),
    };
    const authorFilter = session.role === "author" ? session.user_id : filters.author;
    const result = await data.listAdminPosts(c.env.DB, {
      deleted: true,
      q: filters.q,
      categoryId: filters.category,
      authorId: authorFilter,
      page: Number(c.req.query("page")) || 1,
      perPage: 20,
    });
    const categories = await data.listAdminCategories(c.env.DB);
    const users = await data.listAdminUsers(c.env.DB);
    return sendAdmin(
      c,
      ctx,
      renderPosts(ctx, {
        result,
        filters: { ...filters, author: authorFilter, page: c.req.query("page") },
        categories,
        users,
        canPublish: canPublish(session),
        trash: true,
      }),
    );
  });

  app.get("/admin/posts/new", async (c) => {
    const session = c.get("adminSession");
    const ctx = await adminContext(c, session);
    const draft = {
      title: "",
      slug: "",
      excerpt: "",
      lede: "",
      content_source: "",
      content_format: "markdown",
      status: "draft",
      category_id: String(c.req.query("category") || ""),
      author_id: session.user_id,
      cover_image: "",
      cover_alt: "",
      cover_caption: "",
      seo_title: "",
      seo_description: "",
      focus_keyword: "",
      canonical_url: "",
      og_image: "",
      is_featured: false,
      read_minutes: null,
      tags: [],
    };
    return editorPage(c, ctx, draft, { isNew: true });
  });

  app.post("/admin/posts", async (c) => {
    const session = c.get("adminSession");
    const form = formObject(c);
    const ctx = await adminContext(c, session);
    const action = String(first(form, "action") || "save");
    if (!["save", "draft", "review", "publish", "schedule", "archive"].includes(action)) {
      return adminError(c, 403, "Thao tác không hợp lệ", "Thao tác không hợp lệ.");
    }
    if (["publish", "schedule", "archive"].includes(action) && !canPublish(session)) {
      return adminError(c, 403, "Không có quyền", "Bạn không có quyền xuất bản bài viết.");
    }
    const categories = await data.listAdminCategories(c.env.DB);
    const users = await data.listAdminUsers(c.env.DB);
    const parsed = parsePostForm(form, null, session, categories, users, action);
    if (parsed.error) return editorPage(c, ctx, parsed.values, { isNew: true, error: parsed.error });
    const status = statusForAction(action, null);
    const html = await sanitizeForAdmin(c, parsed.values.content_source, parsed.values.content_format);
    try {
      const post = await data.createAdminPost(
        c.env.DB,
        { ...postDataFromValues({ ...parsed.values, status }, html, status === "scheduled" ? parsed.scheduledAt : null) },
        { actorType: "user", actorId: session.user_id },
      );
      await data.logAudit(c.env.DB, {
        actorType: "user",
        actorId: session.user_id,
        action:
          action === "publish"
            ? "post.published"
            : action === "schedule"
              ? "post.scheduled"
              : action === "review"
                ? "post.submitted"
                : "post.created",
        entityType: "post",
        entityId: post.id,
        meta: { slug: post.slug, status },
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      const msg =
        action === "publish" ? "published" : action === "schedule" ? "scheduled" : action === "review" ? "submitted" : action === "archive" ? "archived" : "created";
      return c.redirect(`/admin/posts/${post.id}/edit?msg=${msg}`, 302);
    } catch (error) {
      return editorPage(c, ctx, parsed.values, { isNew: true, error: error.message || "Không lưu được bài viết." });
    }
  });

  app.get("/admin/posts/:id/edit", async (c) => {
    const session = c.get("adminSession");
    const ctx = await adminContext(c, session);
    const post = await data.getAdminPost(c.env.DB, c.req.param("id"));
    if (!post || post.deleted_at) return adminError(c, 404, "Bài viết không tồn tại", "Bài viết không tồn tại.");
    if (!canEditPost(session, post)) return adminError(c, 403, "Không có quyền", "Bạn không có quyền sửa bài viết này.");
    return editorPage(c, ctx, post, { isNew: false });
  });

  app.post("/admin/posts/:id", async (c) => {
    const session = c.get("adminSession");
    const form = formObject(c);
    const ctx = await adminContext(c, session);
    const existing = await data.getAdminPost(c.env.DB, c.req.param("id"));
    if (!existing || existing.deleted_at) return adminError(c, 404, "Bài viết không tồn tại", "Bài viết không tồn tại.");
    if (!canEditPost(session, existing)) return adminError(c, 403, "Không có quyền", "Bạn không có quyền sửa bài viết này.");
    const action = String(first(form, "action") || "save");
    if (!["save", "draft", "review", "publish", "schedule", "archive"].includes(action)) {
      return adminError(c, 403, "Thao tác không hợp lệ", "Thao tác không hợp lệ.");
    }
    if (["publish", "schedule", "archive"].includes(action) && !canPublish(session)) {
      return adminError(c, 403, "Không có quyền", "Bạn không có quyền xuất bản bài viết.");
    }
    const categories = await data.listAdminCategories(c.env.DB);
    const users = await data.listAdminUsers(c.env.DB);
    const parsed = parsePostForm(form, existing, session, categories, users, action);
    if (parsed.error) {
      return editorPage(c, ctx, { ...existing, ...parsed.values }, { isNew: false, error: parsed.error });
    }
    const status = statusForAction(action, existing);
    const html = await sanitizeForAdmin(c, parsed.values.content_source, parsed.values.content_format);
    try {
      const expectedVersion = Number(first(form, "version")) || null;
      const post = await data.updateAdminPost(
        c.env.DB,
        existing.id,
        {
          ...postDataFromValues({ ...parsed.values, status }, html, status === "scheduled" ? parsed.scheduledAt : existing.scheduled_at),
        },
        { actorType: "user", actorId: session.user_id },
        { expectedVersion },
      );
      await data.logAudit(c.env.DB, {
        actorType: "user",
        actorId: session.user_id,
        action:
          action === "publish"
            ? "post.published"
            : action === "schedule"
              ? "post.scheduled"
              : action === "review"
                ? "post.submitted"
                : action === "archive"
                  ? "post.archived"
                  : "post.updated",
        entityType: "post",
        entityId: post.id,
        meta: { slug: post.slug, status },
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      const msg =
        action === "publish" ? "published" : action === "schedule" ? "scheduled" : action === "review" ? "submitted" : action === "archive" ? "archived" : "saved";
      return c.redirect(`/admin/posts/${post.id}/edit?msg=${msg}`, 302);
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") {
        const latest = await data.getAdminPost(c.env.DB, existing.id);
        return editorPage(c, ctx, latest || existing, {
          isNew: false,
          error: "Bài viết đã được thay đổi bởi phiên khác. Đã tải bản mới; hãy kiểm tra trước khi lưu lại.",
        });
      }
      return editorPage(c, ctx, { ...existing, ...parsed.values }, { isNew: false, error: error.message || "Không lưu được bài viết." });
    }
  });

  app.post("/admin/posts/bulk/apply", async (c) => {
    const session = c.get("adminSession");
    const form = formObject(c);
    const ids = [...new Set(listValue(form, "ids").map(String))];
    const action = String(first(form, "bulk_action") || "");
    const returnTo = safeNext(first(form, "return_to") || "/admin/posts");
    if (!ids.length) return c.redirect(`${returnTo}?err=nothing_selected`, 302);
    if (["publish", "archive"].includes(action) && !canPublish(session)) {
      return adminError(c, 403, "Không có quyền", "Bạn không có quyền xuất bản.");
    }
    if (action === "purge" && !canPurge(session)) {
      return adminError(c, 403, "Không có quyền", "Chỉ quản trị viên mới được xóa vĩnh viễn.");
    }
    if (!["draft", "publish", "archive", "trash", "restore", "purge"].includes(action)) {
      return adminError(c, 403, "Thao tác không hợp lệ", "Thao tác không hợp lệ.");
    }
    const expected = new Map();
    for (const id of ids) {
      const post = await data.getAdminPost(c.env.DB, id);
      if (!post) continue;
      const requested = Number(first(form, `version-${id}`));
      if (!Number.isInteger(requested) || requested < 1) {
        return adminError(c, 409, "Thiếu version", "Một bài trong lựa chọn không có version; tải lại danh sách trước khi thao tác.");
      }
      if (requested !== Number(post.version)) {
        return adminError(c, 409, "Bài viết đã thay đổi", "Một bài trong lựa chọn đã được sửa ở phiên khác; tải lại danh sách trước khi thao tác.");
      }
      expected.set(id, requested);
    }
    let affected = 0;
    const changed = [];
    let conflict = null;
    for (const id of ids) {
      const post = await data.getAdminPost(c.env.DB, id);
      if (!post) continue;
      try {
        if (action === "restore" || action === "purge") {
          if (!post.deleted_at) continue;
          if (session.role === "author" && post.author_id !== session.user_id) continue;
          if (action === "restore") await data.restoreAdminPost(c.env.DB, post.id, { expectedVersion: expected.get(id) });
          else await data.purgeAdminPost(c.env.DB, post.id, { expectedVersion: expected.get(id) });
          affected += 1;
          changed.push(post.id);
          continue;
        }
        if (post.deleted_at || !canEditPost(session, post)) continue;
        if (action === "trash") await data.softDeleteAdminPost(c.env.DB, post.id, { expectedVersion: expected.get(id) });
        else {
          const status = action === "draft" ? "draft" : action === "archive" ? "archived" : "published";
          await data.updateAdminPost(c.env.DB, post.id, { status }, { actorType: "user", actorId: session.user_id }, { expectedVersion: expected.get(id) });
        }
        affected += 1;
        changed.push(post.id);
      } catch (error) {
        if (error.code === "VERSION_CONFLICT") {
          conflict = { id, currentVersion: error.currentVersion, affected, changed };
          break;
        }
        if (error.code === "MEDIA_NOT_READY") {
          return adminError(c, 409, "Ảnh chưa READY", `${error.message} Tải lại danh sách/ảnh trước khi xuất bản.`);
        }
        throw error;
      }
    }
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: conflict ? `post.bulk_${action}_conflict` : `post.bulk_${action}`,
      entityType: "post",
      meta: { count: affected, ids: ids.slice(0, 100), changed: changed.slice(0, 100), conflict },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    if (conflict) {
      return adminError(
        c,
        409,
        "Thao tác dừng do xung đột",
        `${affected} bài đã được cập nhật trước khi phát hiện xung đột ở một bài khác. Tải lại danh sách để kiểm tra trước khi tiếp tục.`,
      );
    }
    return c.redirect(`${returnTo}?msg=bulk_done`, 302);
  });

  app.post("/admin/posts/:id/delete", async (c) => {
    const session = c.get("adminSession");
    const post = await data.getAdminPost(c.env.DB, c.req.param("id"));
    if (!post || post.deleted_at) return adminError(c, 404, "Bài viết không tồn tại", "Bài viết không tồn tại.");
    if (!canEditPost(session, post)) return adminError(c, 403, "Không có quyền", "Bạn không có quyền xóa bài viết này.");
    const version = Number(first(formObject(c), "version"));
    if (!Number.isInteger(version) || version < 1) {
      return adminError(c, 409, "Thiếu version", "Tải lại bài viết trước khi xóa để tránh ghi đè thay đổi mới.");
    }
    try {
      await data.softDeleteAdminPost(c.env.DB, post.id, { expectedVersion: version });
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") return adminError(c, 409, "Bài viết đã thay đổi", "Bài viết đã được sửa ở phiên khác; tải lại trước khi xóa.");
      throw error;
    }
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: "post.trashed",
      entityType: "post",
      entityId: post.id,
      meta: { title: post.title },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return c.redirect(safeNext(first(formObject(c), "return_to") || "/admin/posts?msg=trashed"), 302);
  });

  app.post("/admin/posts/:id/restore", async (c) => {
    const session = c.get("adminSession");
    const post = await data.getAdminPost(c.env.DB, c.req.param("id"));
    if (!post || !post.deleted_at) return adminError(c, 404, "Bài viết không tồn tại", "Bài viết không tồn tại.");
    if (session.role === "author" && post.author_id !== session.user_id) {
      return adminError(c, 403, "Không có quyền", "Bạn không có quyền khôi phục bài viết này.");
    }
    const version = Number(first(formObject(c), "version"));
    if (!Number.isInteger(version) || version < 1) {
      return adminError(c, 409, "Thiếu version", "Tải lại thùng rác trước khi khôi phục để tránh ghi đè thay đổi mới.");
    }
    try {
      await data.restoreAdminPost(c.env.DB, post.id, { expectedVersion: version });
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") return adminError(c, 409, "Bài viết đã thay đổi", "Bài viết đã được sửa ở phiên khác; tải lại trước khi khôi phục.");
      throw error;
    }
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: "post.restored",
      entityType: "post",
      entityId: post.id,
      meta: { title: post.title },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return c.redirect("/admin/trash?msg=restored", 302);
  });

  app.post("/admin/posts/:id/purge", async (c) => {
    const session = c.get("adminSession");
    if (!canPurge(session)) return adminError(c, 403, "Không có quyền", "Chỉ quản trị viên mới được xóa vĩnh viễn.");
    const post = await data.getAdminPost(c.env.DB, c.req.param("id"));
    if (!post || !post.deleted_at) return adminError(c, 404, "Bài viết không tồn tại", "Bài viết không tồn tại.");
    const version = Number(first(formObject(c), "version"));
    if (!Number.isInteger(version) || version < 1) {
      return adminError(c, 409, "Thiếu version", "Tải lại thùng rác trước khi xóa vĩnh viễn.");
    }
    try {
      await data.purgeAdminPost(c.env.DB, post.id, { expectedVersion: version });
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") return adminError(c, 409, "Bài viết đã thay đổi", "Bài viết đã được sửa hoặc khôi phục ở phiên khác; tải lại trước khi xóa vĩnh viễn.");
      throw error;
    }
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: "post.purged",
      entityType: "post",
      entityId: post.id,
      meta: { title: post.title, slug: post.slug },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return c.redirect("/admin/trash?msg=purged", 302);
  });

  app.get("/admin/posts/:id/revisions", async (c) => {
    const session = c.get("adminSession");
    const ctx = await adminContext(c, session);
    const post = await data.getAdminPost(c.env.DB, c.req.param("id"));
    if (!post) return adminError(c, 404, "Bài viết không tồn tại", "Bài viết không tồn tại.");
    if (session.role === "author" && post.author_id !== session.user_id) {
      return adminError(c, 403, "Không có quyền", "Bạn không có quyền xem bài viết này.");
    }
    const revisions = await data.listAdminRevisions(c.env.DB, post.id, 30);
    return sendAdmin(c, ctx, renderRevisions(ctx, { post, revisions }));
  });

  app.post("/admin/posts/:id/revisions/:revisionId/restore", async (c) => {
    const session = c.get("adminSession");
    const post = await data.getAdminPost(c.env.DB, c.req.param("id"));
    if (!post) return adminError(c, 404, "Bài viết không tồn tại", "Bài viết không tồn tại.");
    if (!canEditPost(session, post)) return adminError(c, 403, "Không có quyền", "Bạn không có quyền sửa bài viết này.");
    const revision = await data.getAdminRevision(c.env.DB, c.req.param("revisionId"));
    if (!revision || revision.post_id !== post.id) {
      return adminError(c, 404, "Phiên bản không tồn tại", "Phiên bản không tồn tại.");
    }
    try {
      await data.updateAdminPost(
        c.env.DB,
        post.id,
        {
          title: revision.title,
          excerpt: revision.excerpt,
          contentHtml: revision.content_html,
          contentSource: revision.content_source,
          contentFormat: revision.content_format,
          seoTitle: revision.seo_title,
          seoDescription: revision.seo_description,
          coverImage: revision.cover_image,
        },
        { actorType: "user", actorId: session.user_id },
      );
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") {
        return adminError(c, 409, "Bài viết đã thay đổi", "Bài viết đã được sửa ở phiên khác; tải lại trước khi khôi phục phiên bản.");
      }
      throw error;
    }
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: "post.revision_restored",
      entityType: "post",
      entityId: post.id,
      meta: { revisionId: revision.id },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return c.redirect(`/admin/posts/${post.id}/edit?msg=revision_restored`, 302);
  });

  app.get("/admin/posts/:id/preview", async (c) => {
    const session = c.get("adminSession");
    const post = await data.getAdminPost(c.env.DB, c.req.param("id"));
    if (!post) return adminError(c, 404, "Bài viết không tồn tại", "Bài viết không tồn tại.");
    if (session.role === "author" && post.author_id !== session.user_id) {
      return adminError(c, 403, "Không có quyền", "Bạn không có quyền xem bài viết này.");
    }
    const nonce = newNonce();
    const settings = await getSettings(c.env.DB);
    const [categories, latest] = await Promise.all([listCategoriesFast(c.env.DB), listLatest(c.env.DB, 5)]);
    const ctx = { settings, nonce, user: session, csrf: session.csrf_token, chrome: null };
    const related =
      post.status === "published"
        ? await listRelated(c.env.DB, post, 4)
        : (await listLatest(c.env.DB, 4)).filter((item) => item.id !== post.id).slice(0, 4);
    const adjacent =
      post.status === "published" ? await adjacentPosts(c.env.DB, post) : { prev: null, next: null };
    ctx.chrome = {
      categories,
      latest,
      groups: [...new Set(categories.map((category) => category.group_name))],
    };
    const html = renderArticle(ctx, {
      post,
      related,
      prev: adjacent.prev,
      next: adjacent.next,
      jsonLd: [],
      noindex: true,
      preview: true,
    });
    return sendAdmin(c, ctx, html);
  });

  app.get("/admin/media", async (c) => {
    const session = c.get("adminSession");
    const ctx = await adminContext(c, session);
    const q = String(c.req.query("q") || "").slice(0, 100);
    const pick = c.req.query("pick") === "1";
    const dbItems = await listDbMedia(c, q);
    const legacy = listLegacyMedia().filter((item) => !q || item.original_name.toLowerCase().includes(q.toLowerCase()));
    const result = { items: dbItems, total: dbItems.length, page: 1, perPage: 24, totalPages: 1 };
    return sendAdmin(c, ctx, renderMedia(ctx, { result, q, pick, legacy }));
  });

  app.post("/admin/media", async (c) => {
    const session = c.get("adminSession");
    if (!mediaEnabled(c.env)) return c.redirect("/admin/media?err=media_blocked", 302);
    const form = formObject(c);
    const file = form.file;
    if (!file || typeof file.arrayBuffer !== "function") return c.redirect("/admin/media?err=media_missing", 302);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadMedia(c.env, {
      bytes,
      originalName: file.name,
      declaredMime: file.type,
      alt: first(form, "alt"),
    });
    if (result.error) {
      const code = result.error.status === 413 ? "media_too_large" : result.error.code === "mime_mismatch" ? "media_mime" : "media_invalid";
      return c.redirect(`/admin/media?err=${code}`, 302);
    }
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: "media.uploaded",
      entityType: "media",
      entityId: result.data.id,
      meta: { filename: result.data.filename, mime: result.data.mime, size: result.data.size },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return c.redirect("/admin/media?msg=media_uploaded", 302);
  });

  app.post("/admin/media/:id/alt", async (c) => {
    const session = c.get("adminSession");
    const form = formObject(c);
    const media = await c.env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(c.req.param("id")).first();
    if (!media) return adminError(c, 404, "Ảnh không tồn tại", "Ảnh không tồn tại.");
    await c.env.DB.prepare("UPDATE media SET alt = ? WHERE id = ?").bind(String(first(form, "alt") || "").slice(0, 300), media.id).run();
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: "media.alt_updated",
      entityType: "media",
      entityId: media.id,
      meta: { filename: media.filename },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return c.redirect("/admin/media?msg=media_updated", 302);
  });

  app.post("/admin/media/:id/delete", async (c) => {
    const session = c.get("adminSession");
    const result = await deleteMediaById(c.env, c.req.param("id"));
    if (result.error?.code === "not_found") return adminError(c, 404, "Ảnh không tồn tại", "Ảnh không tồn tại.");
    if (result.error?.code === "media_in_use") return c.redirect("/admin/media?err=media_in_use", 302);
    if (result.error) return c.redirect("/admin/media?err=media_delete_failed", 302);
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: "media.deleted",
      entityType: "media",
      entityId: result.data.id,
      meta: { filename: result.data.filename },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return c.redirect("/admin/media?msg=media_deleted", 302);
  });

  app.get("/admin/categories", async (c) => {
    const session = c.get("adminSession");
    if (!canManageTaxonomy(session)) return adminError(c, 403, "Không có quyền", "Chỉ biên tập viên hoặc quản trị viên mới quản lý chuyên mục.");
    const ctx = await adminContext(c, session);
    return sendAdmin(c, ctx, renderCategories(ctx, { categories: await data.listAdminCategories(c.env.DB) }));
  });

  app.post("/admin/categories", async (c) => {
    const session = c.get("adminSession");
    if (!canManageTaxonomy(session)) return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const name = String(first(form, "name") || "").trim();
    if (name.length < 2 || name.length > 80) return c.redirect("/admin/categories?err=invalid", 302);
    try {
      const category = await data.createAdminCategory(c.env.DB, {
        name,
        slug: String(first(form, "slug") || "").trim(),
        group: first(form, "group") === "tech" ? "tech" : "life",
        description: String(first(form, "description") || "").trim().slice(0, 300),
        sortOrder: Number(first(form, "sort_order")) || 0,
      });
      await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "taxonomy.category_created", entityType: "category", entityId: category.id, meta: { name: category.name }, ip: clientIp(c), userAgent: userAgent(c) });
      return c.redirect("/admin/categories?msg=category_created", 302);
    } catch (error) {
      return c.redirect("/admin/categories?err=duplicate", 302);
    }
  });

  app.post("/admin/categories/:id", async (c) => {
    const session = c.get("adminSession");
    if (!canManageTaxonomy(session)) return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const existing = await data.getAdminCategory(c.env.DB, c.req.param("id"));
    if (!existing) return adminError(c, 404, "Chuyên mục không tồn tại", "Chuyên mục không tồn tại.");
    const name = String(first(form, "name") || "").trim();
    if (name.length < 2 || name.length > 80) return c.redirect("/admin/categories?err=invalid", 302);
    try {
      const category = await data.updateAdminCategory(c.env.DB, existing.id, {
        name,
        slug: String(first(form, "slug") || "").trim(),
        group: first(form, "group") === "tech" ? "tech" : "life",
        description: String(first(form, "description") || "").trim().slice(0, 300),
        sortOrder: Number(first(form, "sort_order")) || 0,
      });
      await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "taxonomy.category_updated", entityType: "category", entityId: category.id, meta: { name: category.name }, ip: clientIp(c), userAgent: userAgent(c) });
      return c.redirect("/admin/categories?msg=category_updated", 302);
    } catch (error) {
      return c.redirect("/admin/categories?err=duplicate", 302);
    }
  });

  app.post("/admin/categories/:id/delete", async (c) => {
    const session = c.get("adminSession");
    if (!canManageTaxonomy(session)) return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const existing = await data.getAdminCategory(c.env.DB, c.req.param("id"));
    if (!existing) return adminError(c, 404, "Chuyên mục không tồn tại", "Chuyên mục không tồn tại.");
    const reassignTo = String(first(form, "reassign_to") || "").trim() || null;
    if (reassignTo) {
      const target = await data.getAdminCategory(c.env.DB, reassignTo);
      if (!target) return c.redirect("/admin/categories?err=invalid", 302);
    }
    try {
      await data.deleteAdminCategory(c.env.DB, existing.id, { reassignTo });
      await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "taxonomy.category_deleted", entityType: "category", entityId: existing.id, meta: { name: existing.name, reassignTo }, ip: clientIp(c), userAgent: userAgent(c) });
      return c.redirect("/admin/categories?msg=category_deleted", 302);
    } catch (error) {
      if (error.code === "CATEGORY_IN_USE") return c.redirect("/admin/categories?err=category_in_use", 302);
      throw error;
    }
  });

  app.get("/admin/tags", async (c) => {
    const session = c.get("adminSession");
    if (!canManageTaxonomy(session)) return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const ctx = await adminContext(c, session);
    return sendAdmin(c, ctx, renderTags(ctx, { tags: await data.listAdminTags(c.env.DB) }));
  });

  app.post("/admin/tags", async (c) => {
    const session = c.get("adminSession");
    if (!canManageTaxonomy(session)) return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const name = String(first(form, "name") || "").trim();
    if (name.length < 2 || name.length > 60) return c.redirect("/admin/tags?err=invalid", 302);
    try {
      const tag = await data.createAdminTag(c.env.DB, { name, slug: String(first(form, "slug") || "").trim() });
      await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "taxonomy.tag_created", entityType: "tag", entityId: tag.id, meta: { name: tag.name }, ip: clientIp(c), userAgent: userAgent(c) });
      return c.redirect("/admin/tags?msg=tag_created", 302);
    } catch (error) {
      return c.redirect("/admin/tags?err=duplicate", 302);
    }
  });

  app.post("/admin/tags/:id", async (c) => {
    const session = c.get("adminSession");
    if (!canManageTaxonomy(session)) return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const name = String(first(form, "name") || "").trim();
    if (name.length < 2 || name.length > 60) return c.redirect("/admin/tags?err=invalid", 302);
    try {
      const tag = await data.updateAdminTag(c.env.DB, c.req.param("id"), { name, slug: String(first(form, "slug") || "").trim() });
      if (!tag) return adminError(c, 404, "Thẻ không tồn tại", "Thẻ không tồn tại.");
      await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "taxonomy.tag_updated", entityType: "tag", entityId: tag.id, meta: { name: tag.name }, ip: clientIp(c), userAgent: userAgent(c) });
      return c.redirect("/admin/tags?msg=tag_updated", 302);
    } catch (error) {
      return c.redirect("/admin/tags?err=duplicate", 302);
    }
  });

  app.post("/admin/tags/:id/delete", async (c) => {
    const session = c.get("adminSession");
    if (!canManageTaxonomy(session)) return adminError(c, 403, "Không có quyền", "Không có quyền.");
    await data.deleteAdminTag(c.env.DB, c.req.param("id"));
    await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "taxonomy.tag_deleted", entityType: "tag", entityId: c.req.param("id"), meta: {}, ip: clientIp(c), userAgent: userAgent(c) });
    return c.redirect("/admin/tags?msg=tag_deleted", 302);
  });

  app.get("/admin/users", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Chỉ quản trị viên mới được quản lý tài khoản.");
    const ctx = await adminContext(c, session);
    return sendAdmin(c, ctx, renderUsers(ctx, await data.listAdminUsers(c.env.DB)));
  });

  app.post("/admin/users", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const name = String(first(form, "name") || "").trim();
    const email = String(first(form, "email") || "").trim().toLowerCase();
    const role = String(first(form, "role") || "author");
    const password = String(first(form, "password") || "");
    if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["admin", "editor", "author"].includes(role)) {
      return c.redirect("/admin/users?err=invalid", 302);
    }
    if (passwordProblem(password)) return c.redirect("/admin/users?err=password_weak", 302);
    try {
      const hash = (await doStub(c, "auth").hashScrypt(password)).hash;
      const user = await data.createAdminUser(c.env.DB, { email, passwordHash: hash, name, role });
      await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "user.created", entityType: "user", entityId: user.id, meta: { email: user.email, role: user.role }, ip: clientIp(c), userAgent: userAgent(c) });
      return c.redirect("/admin/users?msg=user_created", 302);
    } catch (error) {
      return c.redirect("/admin/users?err=email_taken", 302);
    }
  });

  app.post("/admin/users/:id", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const target = await data.findUserById(c.env.DB, c.req.param("id"));
    if (!target) return adminError(c, 404, "Tài khoản không tồn tại", "Tài khoản không tồn tại.");
    const name = String(first(form, "name") || "").trim();
    const email = String(first(form, "email") || "").trim().toLowerCase();
    const role = String(first(form, "role") || target.role);
    const isActive = first(form, "is_active") === "1" ? 1 : 0;
    const password = String(first(form, "password") || "");
    if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["admin", "editor", "author"].includes(role)) {
      return c.redirect("/admin/users?err=invalid", 302);
    }
    const isSelf = target.id === session.user_id;
    if (isSelf && (role !== "admin" || isActive !== 1)) return c.redirect("/admin/users?err=admin_self", 302);
    if (target.role === "admin" && (role !== "admin" || isActive !== 1) && (await data.countActiveAdmins(c.env.DB)) <= 1) {
      return c.redirect("/admin/users?err=last_admin", 302);
    }
    if (password && passwordProblem(password)) return c.redirect("/admin/users?err=password_weak", 302);
    try {
      await data.updateAdminUser(c.env.DB, target.id, { name, email, role, is_active: isActive });
      let passwordChanged = false;
      if (password) {
        const hash = (await doStub(c, "auth").hashScrypt(password)).hash;
        await data.setUserPasswordHash(c.env.DB, target.id, hash);
        passwordChanged = true;
      }
      if (passwordChanged || !isActive) await data.destroyUserSessions(c.env.DB, target.id);
      await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: passwordChanged ? "user.password_reset" : "user.updated", entityType: "user", entityId: target.id, meta: { email, role, is_active: isActive }, ip: clientIp(c), userAgent: userAgent(c) });
      if (passwordChanged && isSelf) {
        deleteCookie(c, SESSION_COOKIE, { path: "/" });
        return c.redirect("/admin/login", 302);
      }
      return c.redirect(`/admin/users?msg=${passwordChanged ? "password_reset" : "user_updated"}`, 302);
    } catch (error) {
      return c.redirect("/admin/users?err=email_taken", 302);
    }
  });

  app.get("/admin/api-clients", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Chỉ quản trị viên mới được quản lý API client.");
    const ctx = await adminContext(c, session);
    const clients = await data.listAdminApiClients(c.env.DB);
    return sendAdmin(c, ctx, renderApiClients(ctx, { clients, apiBase: `${config.siteUrl}/api/v1` }));
  });

  app.post("/admin/api-clients", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const name = String(first(form, "name") || "").trim();
    const scopes = [...new Set(listValue(form, "scopes").filter((scope) => SCOPES.includes(scope)))];
    const publishMode = first(form, "publish_mode") === "auto" ? "auto" : "review";
    const rate = Math.min(600, Math.max(10, Number(first(form, "rate_limit_per_min")) || 60));
    if (name.length < 2 || name.length > 120 || !scopes.length) return c.redirect("/admin/api-clients?err=invalid", 302);
    const result = await data.createAdminApiClient(c.env.DB, { name, scopes, publishMode, rateLimitPerMin: rate });
    await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "apikey.created", entityType: "api_client", entityId: result.client.id, meta: { name, scopes, publishMode }, ip: clientIp(c), userAgent: userAgent(c) });
    const ctx = await adminContext(c, session);
    const clients = await data.listAdminApiClients(c.env.DB);
    return sendAdmin(c, ctx, renderApiClients(ctx, { clients, apiBase: `${config.siteUrl}/api/v1`, newKey: { name: result.client.name, key: result.key } }));
  });

  app.post("/admin/api-clients/:id", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const client = await data.getAdminApiClient(c.env.DB, c.req.param("id"));
    if (!client) return adminError(c, 404, "API client không tồn tại", "API client không tồn tại.");
    const name = String(first(form, "name") || "").trim();
    const scopes = [...new Set(listValue(form, "scopes").filter((scope) => SCOPES.includes(scope)))];
    const publishMode = first(form, "publish_mode") === "auto" ? "auto" : "review";
    const rate = Math.min(600, Math.max(10, Number(first(form, "rate_limit_per_min")) || 60));
    if (name.length < 2 || !scopes.length) return c.redirect("/admin/api-clients?err=invalid", 302);
    await data.updateAdminApiClient(c.env.DB, client.id, { name, scopes, publishMode, rateLimitPerMin: rate });
    await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "apikey.updated", entityType: "api_client", entityId: client.id, meta: { name, scopes, publishMode, rate }, ip: clientIp(c), userAgent: userAgent(c) });
    return c.redirect("/admin/api-clients?msg=client_updated", 302);
  });

  app.post("/admin/api-clients/:id/revoke", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const client = await data.getAdminApiClient(c.env.DB, c.req.param("id"));
    if (!client) return adminError(c, 404, "API client không tồn tại", "API client không tồn tại.");
    await data.revokeAdminApiClient(c.env.DB, client.id);
    await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "apikey.revoked", entityType: "api_client", entityId: client.id, meta: { name: client.name }, ip: clientIp(c), userAgent: userAgent(c) });
    return c.redirect("/admin/api-clients?msg=client_revoked", 302);
  });

  app.post("/admin/api-clients/:id/rotate", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const result = await data.rotateAdminApiKey(c.env.DB, c.req.param("id"));
    if (!result) return adminError(c, 404, "API client không tồn tại", "API client không tồn tại.");
    await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "apikey.rotated", entityType: "api_client", entityId: result.client.id, meta: { name: result.client.name }, ip: clientIp(c), userAgent: userAgent(c) });
    const ctx = await adminContext(c, session);
    const clients = await data.listAdminApiClients(c.env.DB);
    return sendAdmin(c, ctx, renderApiClients(ctx, { clients, apiBase: `${config.siteUrl}/api/v1`, newKey: { name: result.client.name, key: result.key } }));
  });

  app.get("/admin/audit", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Chỉ quản trị viên mới xem nhật ký.");
    const ctx = await adminContext(c, session);
    const scope = c.req.query("scope") === "security" ? "security" : "all";
    const action = String(c.req.query("action") || "").slice(0, 100);
    const actor = String(c.req.query("actor") || "");
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const perPage = 40;
    const result = await data.listAuditRows(c.env.DB, {
      action: action || (scope === "security" ? "security." : ""),
      actorType: ["user", "api", "system"].includes(actor) ? actor : "",
      scope,
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    return sendAdmin(
      c,
      ctx,
      renderAudit(ctx, {
        rows: result.rows,
        total: result.total,
        page,
        totalPages: Math.max(1, Math.ceil(result.total / perPage)),
        filters: { action, actor },
        scope,
      }),
    );
  });

  app.get("/admin/settings", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Chỉ quản trị viên mới xem cài đặt.");
    const ctx = await adminContext(c, session);
    const users = (await data.listAdminUsers(c.env.DB)).filter((user) => user.is_active);
    return sendAdmin(
      c,
      ctx,
      renderSettings(ctx, {
        settings: ctx.settings,
        users,
        info: {
          siteUrl: config.siteUrl,
          nodeEnv: "staging (Cloudflare Workers)",
          nodeVersion: "Workers runtime",
          dbVersion: "D1",
          schemaVersion: 9,
          dbPath: "env.DB (D1 binding)",
          uploadDir: "R2 disabled — media upload blocked",
          blockAi: ctx.settings.allow_ai_crawlers !== "1",
          secureCookies: config.secureCookies,
        },
      }),
    );
  });

  app.post("/admin/settings", async (c) => {
    const session = c.get("adminSession");
    if (session.role !== "admin") return adminError(c, 403, "Không có quyền", "Không có quyền.");
    const form = formObject(c);
    const siteName = String(first(form, "site_name") || "").trim();
    const tagline = String(first(form, "site_tagline") || "").trim();
    const description = String(first(form, "site_description") || "").trim();
    const contact = String(first(form, "contact_email") || "").trim();
    const defaultAuthor = String(first(form, "default_author_id") || "").trim();
    if (siteName.length < 2 || siteName.length > 80) return c.redirect("/admin/settings?err=invalid", 302);
    if (tagline.length > 160 || description.length > 320) return c.redirect("/admin/settings?err=invalid", 302);
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return c.redirect("/admin/settings?err=invalid", 302);
    if (defaultAuthor && !(await data.findUserById(c.env.DB, defaultAuthor))) return c.redirect("/admin/settings?err=invalid", 302);
    await setSettings(c.env.DB, {
      site_name: siteName,
      site_tagline: tagline,
      site_description: description,
      contact_email: contact,
      social_twitter: String(first(form, "social_twitter") || "").trim().slice(0, 120),
      social_facebook: String(first(form, "social_facebook") || "").trim().slice(0, 200),
      default_author_id: defaultAuthor,
      copyright: String(first(form, "copyright") || "").trim().slice(0, 400),
      allow_ai_crawlers: first(form, "allow_ai_crawlers") === "1" ? "1" : "0",
    });
    await data.logAudit(c.env.DB, {
      actorType: "user",
      actorId: session.user_id,
      action: "settings.updated",
      entityType: "settings",
      meta: { keys: Object.keys(form).filter((key) => key !== "_csrf") },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return c.redirect("/admin/settings?msg=settings_saved", 302);
  });

  app.post("/admin/logout", async (c) => {
    const session = c.get("adminSession");
    await data.destroyAdminSession(c.env.DB, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    await data.logAudit(c.env.DB, { actorType: "user", actorId: session.user_id, action: "auth.logout", ip: clientIp(c), userAgent: userAgent(c) });
    return c.redirect("/admin/login?msg=logged_out", 302);
  });

  app.all("/admin/*", async (c) => adminError(c, 404, "Không tìm thấy trang quản trị", "Đường dẫn quản trị không tồn tại."));
}
