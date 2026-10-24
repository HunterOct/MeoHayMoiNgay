import express from "express";
import { notFound, forbidden } from "../../lib/errors.js";
import { fromLocalInput } from "../../lib/time.js";
import { canPublish, canEditPost, canPurge } from "../../lib/permissions.js";
import {
  getById,
  createPost,
  updatePost,
  setStatus,
  softDelete,
  restore,
  purge,
  listAdmin,
  listRevisions,
  getRevision,
  listRelated,
  adjacentPosts,
  listPublished,
  tagsFor,
} from "../../db/posts.js";
import { listCategories } from "../../db/taxonomy.js";
import { listUsers, findById } from "../../db/users.js";
import { logAudit } from "../../db/audit.js";
import { renderEditor } from "../../views/admin/editor.js";
import { renderPosts } from "../../views/admin/posts.js";
import { renderRevisions } from "../../views/admin/revisions.js";
import { renderArticle } from "../../views/article.js";

export const postsRouter = express.Router();

function safeReturn(value, fallback = "/admin/posts") {
  const target = String(value || "");
  return target.startsWith("/admin") && !target.startsWith("//") ? target : fallback;
}

function loadPostOr404(id, { includeDeleted = false } = {}) {
  const post = getById(id);
  if (!post || (!includeDeleted && post.deleted_at)) throw notFound("Bài viết không tồn tại");
  return post;
}

function editorChoices(user) {
  const categories = listCategories();
  const users =
    user.role === "author" ? [findById(user.id)] : listUsers().filter((entry) => entry.is_active);
  return { categories, users };
}

function validUrl(value) {
  if (!value) return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parsePostForm(req, existing, user, action) {
  const body = req.body || {};
  const values = {
    ...(existing || {}),
    title: String(body.title || "").trim(),
    slug: String(body.slug || "").trim(),
    excerpt: String(body.excerpt || "").trim(),
    lede: String(body.lede || "").trim(),
    content_source: String(body.content || ""),
    content_format: body.content_format === "html" ? "html" : "markdown",
    status: existing?.status || "draft",
    category_id: String(body.category_id || ""),
    author_id:
      user.role === "author" ? existing?.author_id || user.id : String(body.author_id || user.id),
    cover_image: String(body.cover_image || "").trim(),
    cover_alt: String(body.cover_alt || "").trim(),
    cover_caption: String(body.cover_caption || "").trim(),
    seo_title: String(body.seo_title || "").trim(),
    seo_description: String(body.seo_description || "").trim(),
    focus_keyword: String(body.focus_keyword || "").trim(),
    canonical_url: String(body.canonical_url || "").trim(),
    og_image: String(body.og_image || "").trim(),
    is_featured: body.is_featured === "1",
    read_minutes: body.read_minutes ? Number(body.read_minutes) : existing?.read_minutes || null,
    tags: String(body.tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8),
  };
  const scheduledAtRaw = String(body.scheduled_at_input || "").trim();
  const scheduledAt = scheduledAtRaw ? fromLocalInput(scheduledAtRaw) : null;

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
  if (values.category_id && !listCategories().some((category) => category.id === values.category_id)) {
    errors.push("Chuyên mục không hợp lệ.");
  }
  if (user.role !== "author") {
    const author = findById(values.author_id);
    if (!author || !author.is_active) errors.push("Tác giả không hợp lệ.");
  }
  if (!validUrl(values.cover_image)) errors.push("Đường dẫn ảnh đại diện không hợp lệ.");
  if (!validUrl(values.og_image)) errors.push("Đường dẫn ảnh OG không hợp lệ.");
  if (!validUrl(values.canonical_url)) errors.push("Canonical URL không hợp lệ (chỉ http/https).");
  if (values.read_minutes && (Number.isNaN(values.read_minutes) || values.read_minutes < 1 || values.read_minutes > 120)) {
    errors.push("Thời gian đọc phải từ 1 đến 120 phút.");
  }
  if (scheduledAtRaw && !scheduledAt) errors.push("Thời điểm lên lịch không hợp lệ.");
  if (action === "schedule") {
    if (!scheduledAt) errors.push("Vui lòng chọn thời điểm xuất bản.");
    else if (new Date(scheduledAt).getTime() <= Date.now()) errors.push("Thời điểm lên lịch phải ở tương lai.");
  }

  return { values, scheduledAt, error: errors[0] || "" };
}

function statusForAction(action, existing, scheduledAt) {
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

function renderEditorPage(req, res, post, { isNew, error = "" }) {
  const { categories, users } = editorChoices(req.user);
  if (Array.isArray(post.tags) && post.tags.length && typeof post.tags[0] === "string") {
    post.tags = post.tags.map((name) => ({ name }));
  }
  return res.send(
    renderEditor(res.locals, {
      post,
      isNew,
      categories,
      users,
      canPublish: canPublish(req.user),
      error,
    }),
  );
}

postsRouter.get("/posts", (req, res) => {
  const filters = {
    status: String(req.query.status || ""),
    q: String(req.query.q || "").slice(0, 100),
    category: String(req.query.category || ""),
    author: String(req.query.author || ""),
  };
  const authorFilter = req.user.role === "author" ? req.user.id : filters.author;
  const result = listAdmin({
    status: filters.status,
    q: filters.q,
    categoryId: filters.category,
    authorId: authorFilter,
    page: Number(req.query.page) || 1,
    perPage: 20,
  });
  const { categories, users } = editorChoices(req.user);
  res.send(
    renderPosts(res.locals, {
      result,
      filters: { ...filters, author: authorFilter, page: req.query.page },
      categories,
      users,
      canPublish: canPublish(req.user),
      trash: false,
    }),
  );
});

postsRouter.get("/trash", (req, res) => {
  const filters = {
    q: String(req.query.q || "").slice(0, 100),
    category: String(req.query.category || ""),
    author: String(req.query.author || ""),
  };
  const authorFilter = req.user.role === "author" ? req.user.id : filters.author;
  const result = listAdmin({
    deleted: true,
    q: filters.q,
    categoryId: filters.category,
    authorId: authorFilter,
    page: Number(req.query.page) || 1,
    perPage: 20,
  });
  const { categories, users } = editorChoices(req.user);
  res.send(
    renderPosts(res.locals, {
      result,
      filters: { ...filters, author: authorFilter, page: req.query.page },
      categories,
      users,
      canPublish: canPublish(req.user),
      trash: true,
    }),
  );
});

postsRouter.get("/posts/new", (req, res) => {
  const draft = {
    title: "",
    slug: "",
    excerpt: "",
    lede: "",
    content_source: "",
    content_format: "markdown",
    status: "draft",
    category_id: String(req.query.category || ""),
    author_id: req.user.id,
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
  return renderEditorPage(req, res, draft, { isNew: true });
});

postsRouter.post("/posts", (req, res, next) => {
  try {
    const action = String(req.body?.action || "save");
    if (!["save", "draft", "review", "publish", "schedule", "archive"].includes(action)) {
      throw forbidden("Thao tác không hợp lệ.");
    }
    if (["publish", "schedule", "archive"].includes(action) && !canPublish(req.user)) {
      throw forbidden("Bạn không có quyền xuất bản bài viết.");
    }
    const { values, scheduledAt, error } = parsePostForm(req, null, req.user, action);
    if (error) return renderEditorPage(req, res, values, { isNew: true, error });
    const status = statusForAction(action, null, scheduledAt);
    const post = createPost(
      {
        title: values.title,
        slug: values.slug,
        excerpt: values.excerpt,
        lede: values.lede,
        contentSource: values.content_source,
        contentFormat: values.content_format,
        status,
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
        scheduledAt: status === "scheduled" ? scheduledAt : null,
        tags: values.tags,
        origin: "admin",
      },
      { actorType: "user", actorId: req.user.id },
    );
    logAudit({
      actorType: "user",
      actorId: req.user.id,
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
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    const msg =
      action === "publish"
        ? "published"
        : action === "schedule"
          ? "scheduled"
          : action === "review"
            ? "submitted"
            : action === "archive"
              ? "archived"
              : "created";
    return res.redirect(`/admin/posts/${post.id}/edit?msg=${msg}`);
  } catch (error) {
    next(error);
  }
});

postsRouter.get("/posts/:id/edit", (req, res, next) => {
  try {
    const post = loadPostOr404(req.params.id);
    if (!canEditPost(req.user, post)) throw forbidden("Bạn không có quyền sửa bài viết này.");
    post.tags = tagsFor(post.id);
    return renderEditorPage(req, res, post, { isNew: false });
  } catch (error) {
    next(error);
  }
});

postsRouter.post("/posts/bulk", (req, res, next) => {
  try {
    const ids = [...new Set([].concat(req.body.ids || []).map(String))];
    const action = String(req.body.bulk_action || "");
    if (!ids.length) return res.redirect(safeReturn(req.body.return_to, "/admin/posts?err=nothing_selected"));
    if (["publish", "archive"].includes(action) && !canPublish(req.user)) {
      throw forbidden("Bạn không có quyền xuất bản.");
    }
    if (action === "purge" && !canPurge(req.user)) {
      throw forbidden("Chỉ quản trị viên mới được xóa vĩnh viễn.");
    }
    const allowedActions = ["draft", "publish", "archive", "trash", "restore", "purge"];
    if (!allowedActions.includes(action)) throw forbidden("Thao tác không hợp lệ.");
    let affected = 0;
    for (const id of ids) {
      const post = getById(id);
      if (!post) continue;
      if (action === "restore" || action === "purge") {
        if (!post.deleted_at) continue;
        if (req.user.role === "author" && post.author_id !== req.user.id) continue;
        if (action === "restore") restore(post.id);
        else purge(post.id);
        affected += 1;
        continue;
      }
      if (post.deleted_at) continue;
      if (!canEditPost(req.user, post)) continue;
      if (action === "trash") {
        softDelete(post.id);
      } else {
        const statusMap = { draft: "draft", publish: "published", archive: "archived" };
        setStatus(post.id, statusMap[action], { actorType: "user", actorId: req.user.id });
      }
      affected += 1;
    }
    logAudit({
      actorType: "user",
      actorId: req.user.id,
      action: `post.bulk_${action}`,
      entityType: "post",
      meta: { count: affected, ids: ids.slice(0, 100) },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return res.redirect(safeReturn(req.body.return_to, "/admin/posts?msg=bulk_done"));
  } catch (error) {
    next(error);
  }
});

postsRouter.post("/posts/:id", (req, res, next) => {
  try {
    const existing = loadPostOr404(req.params.id);
    if (!canEditPost(req.user, existing)) throw forbidden("Bạn không có quyền sửa bài viết này.");
    const action = String(req.body?.action || "save");
    if (!["save", "draft", "review", "publish", "schedule", "archive"].includes(action)) {
      throw forbidden("Thao tác không hợp lệ.");
    }
    if (["publish", "schedule", "archive"].includes(action) && !canPublish(req.user)) {
      throw forbidden("Bạn không có quyền xuất bản bài viết.");
    }
    const { values, scheduledAt, error } = parsePostForm(req, existing, req.user, action);
    if (error) return renderEditorPage(req, res, { ...existing, ...values }, { isNew: false, error });
    const status = statusForAction(action, existing, scheduledAt);
    const post = updatePost(
      existing.id,
      {
        title: values.title,
        slug: values.slug,
        excerpt: values.excerpt,
        lede: values.lede,
        contentSource: values.content_source,
        contentFormat: values.content_format,
        status,
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
        scheduledAt: status === "scheduled" ? scheduledAt : existing.scheduled_at,
        tags: values.tags,
      },
      { actorType: "user", actorId: req.user.id },
    );
    logAudit({
      actorType: "user",
      actorId: req.user.id,
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
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    const msg =
      action === "publish"
        ? "published"
        : action === "schedule"
          ? "scheduled"
          : action === "review"
            ? "submitted"
            : action === "archive"
              ? "archived"
              : "saved";
    return res.redirect(`/admin/posts/${post.id}/edit?msg=${msg}`);
  } catch (error) {
    next(error);
  }
});

postsRouter.post("/posts/:id/delete", (req, res, next) => {
  try {
    const post = loadPostOr404(req.params.id);
    if (!canEditPost(req.user, post)) throw forbidden("Bạn không có quyền xóa bài viết này.");
    softDelete(post.id);
    logAudit({
      actorType: "user",
      actorId: req.user.id,
      action: "post.trashed",
      entityType: "post",
      entityId: post.id,
      meta: { title: post.title },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return res.redirect(safeReturn(req.body.return_to, "/admin/posts?msg=trashed"));
  } catch (error) {
    next(error);
  }
});

postsRouter.post("/posts/:id/restore", (req, res, next) => {
  try {
    const post = loadPostOr404(req.params.id, { includeDeleted: true });
    if (req.user.role === "author" && post.author_id !== req.user.id) {
      throw forbidden("Bạn không có quyền khôi phục bài viết này.");
    }
    restore(post.id);
    logAudit({
      actorType: "user",
      actorId: req.user.id,
      action: "post.restored",
      entityType: "post",
      entityId: post.id,
      meta: { title: post.title },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return res.redirect("/admin/trash?msg=restored");
  } catch (error) {
    next(error);
  }
});

postsRouter.post("/posts/:id/purge", (req, res, next) => {
  try {
    if (!canPurge(req.user)) throw forbidden("Chỉ quản trị viên mới được xóa vĩnh viễn.");
    const post = loadPostOr404(req.params.id, { includeDeleted: true });
    purge(post.id);
    logAudit({
      actorType: "user",
      actorId: req.user.id,
      action: "post.purged",
      entityType: "post",
      entityId: post.id,
      meta: { title: post.title, slug: post.slug },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return res.redirect("/admin/trash?msg=purged");
  } catch (error) {
    next(error);
  }
});

postsRouter.get("/posts/:id/revisions", (req, res, next) => {
  try {
    const post = loadPostOr404(req.params.id, { includeDeleted: true });
    if (!canEditPost(req.user, post) && req.user.role === "author" && post.author_id !== req.user.id) {
      throw forbidden("Bạn không có quyền xem bài viết này.");
    }
    const revisions = listRevisions(post.id, 30);
    res.send(renderRevisions(res.locals, { post, revisions }));
  } catch (error) {
    next(error);
  }
});

postsRouter.post("/posts/:id/revisions/:revisionId/restore", (req, res, next) => {
  try {
    const post = loadPostOr404(req.params.id, { includeDeleted: true });
    if (!canEditPost(req.user, post)) throw forbidden("Bạn không có quyền sửa bài viết này.");
    const revision = getRevision(req.params.revisionId);
    if (!revision || revision.post_id !== post.id) throw notFound("Phiên bản không tồn tại");
    updatePost(
      post.id,
      {
        title: revision.title,
        excerpt: revision.excerpt,
        contentSource: revision.content_source,
        contentFormat: revision.content_format,
        seoTitle: revision.seo_title,
        seoDescription: revision.seo_description,
        coverImage: revision.cover_image,
      },
      { actorType: "user", actorId: req.user.id },
    );
    logAudit({
      actorType: "user",
      actorId: req.user.id,
      action: "post.revision_restored",
      entityType: "post",
      entityId: post.id,
      meta: { revisionId: revision.id },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return res.redirect(`/admin/posts/${post.id}/edit?msg=revision_restored`);
  } catch (error) {
    next(error);
  }
});

postsRouter.get("/posts/:id/preview", (req, res, next) => {
  try {
    const post = loadPostOr404(req.params.id, { includeDeleted: true });
    if (req.user.role === "author" && post.author_id !== req.user.id && !canEditPost(req.user, post)) {
      throw forbidden("Bạn không có quyền xem bài viết này.");
    }
    const categories = listCategories({ withCounts: true });
    res.locals.chrome = {
      categories,
      latest: listPublished({ perPage: 5 }).items,
      groups: [...new Set(categories.map((category) => category.group_name))],
    };
    post.tags = tagsFor(post.id);
    const related =
      post.status === "published"
        ? listRelated(post, 4)
        : listPublished({ perPage: 4, excludeId: post.id }).items;
    const { prev, next: nextPost } =
      post.status === "published" ? adjacentPosts(post) : { prev: null, next: null };
    res.setHeader("Cache-Control", "no-store");
    res.send(
      renderArticle(res.locals, {
        post,
        related,
        prev,
        next: nextPost,
        jsonLd: [],
        noindex: true,
        preview: true,
      }),
    );
  } catch (error) {
    next(error);
  }
});
