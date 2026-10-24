import express from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { config } from "../config.js";
import {
  createPost,
  updatePost,
  getById,
  getAnyBySlug,
  findByExternalId,
  setStatus,
  softDelete,
  listAdmin,
  tagsFor,
} from "../db/posts.js";
import { listCategories, listTags } from "../db/taxonomy.js";
import { getMedia } from "../db/media.js";
import { getDb } from "../db/index.js";
import { hasScope } from "../db/apikeys.js";
import { logAudit } from "../db/audit.js";
import { storeImage } from "../lib/uploads.js";
import { excerptFrom, toHtml } from "../lib/sanitize.js";
import { HttpError, badRequest, conflict, forbidden, gone, notFound } from "../lib/errors.js";
import {
  apiHeaders,
  apiIpLimit,
  preventKeyInQuery,
  apiAuth,
  clientRateLimit,
  requireScope,
  requireAnyScope,
  beginIdempotency,
  replayIdempotent,
  storeIdempotent,
  parseDate,
  resolveRequestedStatus,
  resolveCategory,
  defaultAuthorId,
  apiAudit,
} from "../middleware/api.js";
import {
  createPostSchema,
  updatePostSchema,
  scheduleSchema,
  unpublishSchema,
  validationDetails,
} from "../lib/api-schemas.js";
import { serializePost, serializeMedia } from "../lib/api-serialize.js";

export const apiRouter = express.Router();

const STATUSES = ["draft", "review", "scheduled", "published", "archived"];

apiRouter.use(apiHeaders);
apiRouter.use(apiIpLimit);
apiRouter.use(preventKeyInQuery);

apiRouter.get("/health", (req, res) => {
  try {
    getDb().prepare("SELECT 1").get();
    res.json({ status: "ok", time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error" });
  }
});

apiRouter.get("/openapi.yaml", (req, res, next) => {
  const file = path.join(config.rootDir, "openapi.yaml");
  try {
    const content = fs.readFileSync(file, "utf8");
    res.type("text/yaml; charset=utf-8").setHeader("Cache-Control", "public, max-age=300");
    res.send(content);
  } catch {
    next(notFound("Chưa có tài liệu OpenAPI."));
  }
});

apiRouter.use(apiAuth);
apiRouter.use(clientRateLimit);

apiRouter.get("/me", (req, res) => {
  const client = req.apiClient;
  res.json({
    data: {
      id: client.id,
      name: client.name,
      scopes: client.scopes,
      publish_mode: client.publish_mode,
      rate_limit_per_min: client.rate_limit_per_min,
      last_used_at: client.last_used_at,
      created_at: client.created_at,
    },
  });
});

function authIdOrThrow() {
  const id = defaultAuthorId();
  if (!id) throw new HttpError(503, "Chưa có tài khoản tác giả để gán bài viết.", { code: "no_author" });
  return id;
}

function publishedMeta(client, demoted, state) {
  return {
    publish_mode: client.publish_mode,
    publish_demoted: demoted,
    ...(state?.key ? { idempotency_key: state.key } : {}),
  };
}

function manageCover(parsed) {
  let coverImage;
  let coverAlt;
  if (parsed.cover_media_id) {
    const media = getMedia(parsed.cover_media_id);
    if (!media) {
      throw badRequest("cover_media_id không tồn tại.", {
        code: "validation_error",
        details: [{ path: "cover_media_id", message: "Không tìm thấy ảnh." }],
      });
    }
    coverImage = `/media/${media.filename}`;
    coverAlt = parsed.cover_alt ?? media.alt;
  } else {
    if (parsed.cover_image !== undefined) coverImage = parsed.cover_image;
    if (parsed.cover_alt !== undefined) coverAlt = parsed.cover_alt;
  }
  return { coverImage, coverAlt };
}

function requireContent(status, content) {
  if (["review", "published", "scheduled"].includes(status) && String(content || "").trim().length < 20) {
    throw badRequest("Nội dung cần tối thiểu 20 ký tự để gửi duyệt hoặc xuất bản.", {
      code: "validation_error",
      details: [{ path: "content", message: "Nội dung quá ngắn." }],
    });
  }
}

function parseBody(schema, req) {
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    throw badRequest("Dữ liệu không hợp lệ.", {
      code: "validation_error",
      details: validationDetails(parsed.error),
    });
  }
  return parsed.data;
}

apiRouter.get(
  "/categories",
  requireAnyScope(["taxonomy:read", "posts:read", "posts:write"]),
  (req, res) => {
    const categories = listCategories({ withCounts: true });
    res.json({
      data: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        group: category.group_name,
        description: category.description,
        published_posts: category.post_count,
      })),
    });
  },
);

apiRouter.get(
  "/tags",
  requireAnyScope(["taxonomy:read", "posts:read", "posts:write"]),
  (req, res) => {
    const tags = listTags({ withCounts: true });
    res.json({
      data: tags.map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug, published_posts: tag.post_count })),
    });
  },
);

apiRouter.get("/posts", requireScope("posts:read"), (req, res) => {
  const status = String(req.query.status || "");
  if (status && !STATUSES.includes(status)) {
    throw badRequest("status không hợp lệ.", {
      code: "validation_error",
      details: [{ path: "status", message: `Giá trị hợp lệ: ${STATUSES.join(", ")}` }],
    });
  }
  const category = req.query.category ? resolveCategory(String(req.query.category)) : null;
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const q = String(req.query.q || "").slice(0, 100);
  const result = listAdmin({
    status,
    q,
    categoryId: category?.id || "",
    perPage: limit,
    offset,
  });
  res.json({
    data: result.items.map((post) =>
      serializePost(post, { includeHtml: false, includeContent: false }),
    ),
    pagination: {
      total: result.total,
      limit,
      offset,
      has_more: offset + result.items.length < result.total,
    },
  });
});

apiRouter.get("/posts/slug/:slug", requireScope("posts:read"), (req, res) => {
  const post = getAnyBySlug(String(req.params.slug || ""));
  if (!post) throw notFound("Bài viết không tồn tại.");
  if (post.deleted_at) throw gone("Bài viết đã bị xóa.");
  post.tags = tagsFor(post.id);
  res.json({ data: serializePost(post) });
});

apiRouter.get("/posts/:id", requireScope("posts:read"), (req, res) => {
  const post = getById(req.params.id);
  if (!post) throw notFound("Bài viết không tồn tại.");
  if (post.deleted_at) throw gone("Bài viết đã bị xóa.");
  post.tags = tagsFor(post.id);
  res.json({ data: serializePost(post) });
});

apiRouter.post("/posts", requireScope("posts:write"), (req, res) => {
  const state = beginIdempotency(req);
  if (replayIdempotent(res, state)) return;

  const parsed = parseBody(createPostSchema, req);
  if (parsed.external_id) {
    const existing = findByExternalId(req.apiClient.id, parsed.external_id);
    if (existing) {
      if (existing.deleted_at) {
        throw conflict("external_id đã thuộc về một bài đã xóa.", { code: "external_id_conflict" });
      }
      existing.tags = tagsFor(existing.id);
      return res.status(200).json({
        data: serializePost(existing),
        meta: { ...publishedMeta(req.apiClient, false, state), external_id_replayed: true },
      });
    }
  }

  const requested = parsed.status || "draft";
  const providedSchedule = parsed.scheduled_at
    ? parseDate(parsed.scheduled_at, { future: requested === "scheduled" })
    : null;
  const decision = resolveRequestedStatus(req.apiClient, requested, {
    scheduledAt: providedSchedule,
  });
  const status = decision.status;
  const contentFormat = parsed.content_format || "markdown";
  const contentSource = parsed.content || "";
  requireContent(status, contentSource);

  const category = parsed.category ? resolveCategory(parsed.category) : null;
  const cover = manageCover(parsed);
  const rendered = toHtml(contentSource, contentFormat);
  const excerpt = parsed.excerpt || excerptFrom(rendered, 180);
  const seo = parsed.seo || {};

  let post;
  try {
    post = createPost(
      {
        title: parsed.title,
        slug: parsed.slug,
        excerpt,
        lede: parsed.lede || "",
        contentSource,
        contentFormat,
        status,
        categoryId: category?.id || null,
        authorId: authIdOrThrow(),
        coverImage: cover.coverImage || "",
        coverAlt: cover.coverAlt || "",
        coverCaption: parsed.cover_caption || "",
        seoTitle: seo.title || "",
        seoDescription: seo.description || excerpt,
        focusKeyword: seo.focus_keyword || "",
        canonicalUrl: seo.canonical_url || "",
        ogImage: seo.og_image || cover.coverImage || "",
        isFeatured: Boolean(parsed.is_featured),
        readMinutes: parsed.read_minutes || undefined,
        scheduledAt: decision.status === "scheduled" ? providedSchedule : null,
        tags: parsed.tags || [],
        origin: "api",
        apiClientId: req.apiClient.id,
        externalId: parsed.external_id || null,
      },
      { actorType: "api", actorId: req.apiClient.id },
    );
  } catch (error) {
    if (parsed.external_id && /idx_posts_client_external|external_id/i.test(String(error.message))) {
      const existing = findByExternalId(req.apiClient.id, parsed.external_id);
      if (existing && !existing.deleted_at) {
        existing.tags = tagsFor(existing.id);
        return res.status(200).json({
          data: serializePost(existing),
          meta: { ...publishedMeta(req.apiClient, false, state), external_id_replayed: true },
        });
      }
    }
    throw error;
  }

  apiAudit(req, decision.demoted ? "api.post_submitted" : "api.post_created", post.id, {
    slug: post.slug,
    status,
    demoted: decision.demoted,
    external_id: parsed.external_id || null,
  });
  const payload = {
    data: serializePost(post),
    meta: publishedMeta(req.apiClient, decision.demoted, state),
  };
  storeIdempotent(req, state, 201, payload);
  res.status(201).json(payload);
});

apiRouter.patch("/posts/:id", requireScope("posts:write"), (req, res) => {
  const state = beginIdempotency(req);
  if (replayIdempotent(res, state)) return;

  const post = getById(req.params.id);
  if (!post) throw notFound("Bài viết không tồn tại.");
  if (post.deleted_at) throw gone("Bài viết đã bị xóa.");
  if (post.status === "published" && !hasScope(req.apiClient, "posts:publish")) {
    throw forbidden("Cần quyền posts:publish để sửa bài đã xuất bản.");
  }

  const parsed = parseBody(updatePostSchema, req);
  const patch = {};
  if (parsed.title !== undefined) patch.title = parsed.title;
  if (parsed.slug !== undefined) patch.slug = parsed.slug;
  if (parsed.excerpt !== undefined) patch.excerpt = parsed.excerpt;
  if (parsed.lede !== undefined) patch.lede = parsed.lede;
  if (parsed.content !== undefined) patch.contentSource = parsed.content;
  if (parsed.content_format !== undefined) patch.contentFormat = parsed.content_format;
  if (parsed.tags !== undefined) patch.tags = parsed.tags;
  if (parsed.is_featured !== undefined) patch.isFeatured = parsed.is_featured;
  if (parsed.read_minutes !== undefined) patch.readMinutes = parsed.read_minutes;
  if (parsed.category !== undefined) {
    patch.categoryId = parsed.category ? resolveCategory(parsed.category)?.id || null : null;
  }
  const cover = manageCover(parsed);
  if (cover.coverImage !== undefined) patch.coverImage = cover.coverImage;
  if (cover.coverAlt !== undefined) patch.coverAlt = cover.coverAlt;
  if (parsed.cover_caption !== undefined) patch.coverCaption = parsed.cover_caption;
  if (parsed.seo) {
    if (parsed.seo.title !== undefined) patch.seoTitle = parsed.seo.title;
    if (parsed.seo.description !== undefined) patch.seoDescription = parsed.seo.description;
    if (parsed.seo.focus_keyword !== undefined) patch.focusKeyword = parsed.seo.focus_keyword;
    if (parsed.seo.canonical_url !== undefined) patch.canonicalUrl = parsed.seo.canonical_url;
    if (parsed.seo.og_image !== undefined) patch.ogImage = parsed.seo.og_image;
  }

  let demoted = false;
  let effectiveStatus = post.status;
  if (parsed.status !== undefined) {
    const scheduledAt =
      parsed.scheduled_at !== undefined
        ? parseDate(parsed.scheduled_at, { future: parsed.status === "scheduled" })
        : parsed.status === "scheduled"
          ? parseDate(post.scheduled_at, { future: true })
          : null;
    const decision = resolveRequestedStatus(req.apiClient, parsed.status, { scheduledAt });
    patch.status = decision.status;
    patch.scheduledAt = decision.status === "scheduled" ? scheduledAt : null;
    demoted = decision.demoted;
    effectiveStatus = decision.status;
  } else if (parsed.scheduled_at !== undefined && post.status === "scheduled") {
    patch.scheduledAt = parseDate(parsed.scheduled_at, { future: true });
  }

  const effectiveContent =
    parsed.content !== undefined ? parsed.content : post.content_source || "";
  requireContent(effectiveStatus, effectiveContent);

  const updated = updatePost(post.id, patch, { actorType: "api", actorId: req.apiClient.id });
  apiAudit(req, "api.post_updated", updated.id, {
    slug: updated.slug,
    status: effectiveStatus,
    demoted,
    fields: Object.keys(patch),
  });
  const payload = {
    data: serializePost(updated),
    meta: publishedMeta(req.apiClient, demoted, state),
  };
  storeIdempotent(req, state, 200, payload);
  res.status(200).json(payload);
});

function loadEditable(id) {
  const post = getById(id);
  if (!post) throw notFound("Bài viết không tồn tại.");
  if (post.deleted_at) throw gone("Bài viết đã bị xóa.");
  return post;
}

function requireAutoMode(req, res, next) {
  if (req.apiClient.publish_mode !== "auto") {
    return next(
      new HttpError(403, "API client đang ở chế độ chờ duyệt, không thể xuất bản trực tiếp.", {
        code: "publish_mode_review",
      }),
    );
  }
  next();
}

apiRouter.post("/posts/:id/publish", requireAutoMode, requireScope("posts:publish"), (req, res) => {
  const state = beginIdempotency(req);
  if (replayIdempotent(res, state)) return;
  const post = loadEditable(req.params.id);
  const updated = setStatus(post.id, "published", { actorType: "api", actorId: req.apiClient.id });
  apiAudit(req, "api.post_published", updated.id, { slug: updated.slug });
  const payload = { data: serializePost(updated), meta: publishedMeta(req.apiClient, false, state) };
  storeIdempotent(req, state, 200, payload);
  res.status(200).json(payload);
});

apiRouter.post("/posts/:id/schedule", requireAutoMode, requireScope("posts:publish"), (req, res) => {
  const state = beginIdempotency(req);
  if (replayIdempotent(res, state)) return;
  const post = loadEditable(req.params.id);
  const parsed = parseBody(scheduleSchema, req);
  const scheduledAt = parseDate(parsed.scheduled_at, { future: true });
  requireContent("scheduled", post.content_source);
  const updated = setStatus(post.id, "scheduled", {
    actorType: "api",
    actorId: req.apiClient.id,
    scheduledAt,
  });
  apiAudit(req, "api.post_scheduled", updated.id, { slug: updated.slug, scheduled_at: scheduledAt });
  const payload = { data: serializePost(updated), meta: publishedMeta(req.apiClient, false, state) };
  storeIdempotent(req, state, 200, payload);
  res.status(200).json(payload);
});

apiRouter.post("/posts/:id/unpublish", requireAutoMode, requireScope("posts:publish"), (req, res) => {
  const state = beginIdempotency(req);
  if (replayIdempotent(res, state)) return;
  const post = loadEditable(req.params.id);
  const parsed = parseBody(unpublishSchema, req);
  const target = parsed.status || "draft";
  const updated = setStatus(post.id, target, { actorType: "api", actorId: req.apiClient.id });
  apiAudit(req, "api.post_unpublished", updated.id, { slug: updated.slug, status: target });
  const payload = { data: serializePost(updated), meta: publishedMeta(req.apiClient, false, state) };
  storeIdempotent(req, state, 200, payload);
  res.status(200).json(payload);
});

apiRouter.delete("/posts/:id", requireAutoMode, requireScope("posts:publish"), (req, res) => {
  const post = getById(req.params.id);
  if (!post) throw notFound("Bài viết không tồn tại.");
  if (!post.deleted_at) {
    softDelete(post.id);
    apiAudit(req, "api.post_deleted", post.id, { slug: post.slug });
  }
  res.json({ data: { id: post.id, deleted: true } });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

function uploadSingle(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (error) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(new HttpError(413, "Ảnh vượt quá dung lượng cho phép.", { code: "payload_too_large" }));
      }
      return next(badRequest("Tải ảnh thất bại. Kiểm tra định dạng và kích thước tệp.", { code: "upload_failed" }));
    }
    next();
  });
}

apiRouter.post("/media", requireScope("media:write"), uploadSingle, (req, res) => {
  if (!req.file) {
    throw badRequest("Thiếu tệp trong trường multipart “file”.", {
      code: "validation_error",
      details: [{ path: "file", message: "Chưa gửi tệp." }],
    });
  }
  const media = storeImage({
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    alt: req.body.alt || "",
    uploadedBy: null,
  });
  logAudit({
    actorType: "api",
    actorId: req.apiClient.id,
    action: "api.media_uploaded",
    entityType: "media",
    entityId: media.id,
    meta: { filename: media.filename, size: media.size, mime: media.mime },
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  });
  res.status(201).json({ data: serializeMedia(media) });
});
