import express from "express";
import { config } from "../config.js";
import { loadPublicChrome } from "../middleware/chrome.js";
import { botGuard } from "../middleware/bot-guard.js";
import { createEnumerationGuard, createRateLimiter } from "../middleware/rate-limit.js";
import { logAudit } from "../db/audit.js";
import { notFound } from "../lib/errors.js";
import {
  listPublished,
  listPopular,
  getPublishedBySlug,
  getTrashedBySlug,
  findHistoricalSlug,
  incrementViews,
  listRelated,
  adjacentPosts,
  tagsFor,
} from "../db/posts.js";
import { getCategoryBySlug, getTagBySlug } from "../db/taxonomy.js";
import { renderHome } from "../views/home.js";
import { renderList } from "../views/list.js";
import { renderArticle } from "../views/article.js";
import { renderError } from "../views/error.js";
import { GROUP_META } from "../views/constants.js";
import { pagedUrl, searchUrl } from "../views/helpers.js";
import { articleLd, breadcrumbLd, collectionLd, websiteLd, organizationLd } from "../lib/seo.js";

export const publicRouter = express.Router();

publicRouter.use(loadPublicChrome);

publicRouter.use(
  createRateLimiter({
    windowMs: 60_000,
    max: config.rateLimitHtmlPerMin,
    prefix: "html",
    skip: (req) => req.isVerifiedBot,
    onLimit: (req, count) => {
      logAudit({
        actorType: "system",
        action: "security.rate_limited",
        meta: { path: req.path, count, scope: "html" },
        ip: req.ip,
        userAgent: req.get("user-agent") || "",
      });
    },
  }),
);

publicRouter.use(botGuard);

const articleEnumerationGuard = createEnumerationGuard({
  onLimit: (req, count) => {
    logAudit({
      actorType: "system",
      action: "security.article_enumeration",
      meta: { path: req.path, count },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
  },
});

const cacheSeconds = (seconds) =>
  `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`;

function htmlCache(seconds) {
  return (req, res, next) => {
    res.setHeader("Cache-Control", cacheSeconds(seconds));
    next();
  };
}

function pageNumber(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function renderCollection(req, res, opts) {
  const { items, total, page, totalPages } = opts.result;
  const canonicalPath = page > 1 ? pagedUrl(opts.basePath, page) : opts.basePath;
  return renderList(res.locals, {
    title: opts.title,
    heading: opts.heading,
    description: opts.description || "",
    posts: items,
    total,
    page,
    totalPages,
    hrefFor: (n) => pagedUrl(opts.basePath, n),
    canonicalPath,
    activeCategorySlug: opts.activeCategorySlug || "",
    activeGroup: opts.activeGroup || "",
    activeAll: opts.activeAll || false,
    noindex: Boolean(opts.noindex),
    searchQuery: "",
    crumbs: opts.crumbs || [],
    popular: listPopular(5),
    jsonLd: opts.jsonLd || [],
    emptyTitle: opts.emptyTitle,
    emptyMessage: opts.emptyMessage,
  });
}

publicRouter.get("/", htmlCache(60), (req, res) => {
  const ctx = res.locals;
  const { items } = listPublished({ perPage: 16 });
  res.send(
    renderHome(ctx, {
      slides: items.slice(0, 5),
      side: items.slice(5, 10),
      thumbs: items.slice(10, 16),
      grid: items.slice(0, 8),
      popular: listPopular(5),
      jsonLd: [websiteLd(ctx.settings), organizationLd(ctx.settings)],
    }),
  );
});

function renderArchive(req, res, page) {
  const ctx = res.locals;
  const result = listPublished({ perPage: 8, page });
  if (page > result.totalPages) return null;
  return renderCollection(req, res, {
    result,
    basePath: "/bai-viet",
    title: page > 1 ? `Tất cả bài viết — Trang ${page}` : "Tất cả bài viết",
    heading: "Tất cả bài viết",
    description: "Toàn bộ mẹo vặt đời sống và công nghệ, mới nhất trước.",
    activeAll: true,
    crumbs: [{ label: "Trang chủ", href: "/" }, { label: "Tất cả bài viết" }],
    jsonLd:
      page === 1
        ? [
            collectionLd({
              name: "Tất cả bài viết",
              description: ctx.settings.site_description,
              url: "/bai-viet",
              items: result.items,
            }),
            breadcrumbLd([
              { name: "Trang chủ", url: "/" },
              { name: "Tất cả bài viết", url: "/bai-viet" },
            ]),
          ]
        : [],
    emptyTitle: "Chưa có bài viết nào",
    emptyMessage: "Bài viết sẽ xuất hiện ở đây ngay khi được đăng.",
  });
}

publicRouter.get("/bai-viet/trang/:page", htmlCache(60), (req, res, next) => {
  const page = pageNumber(req.params.page);
  if (!page) return next(notFound());
  if (page === 1) return res.redirect(301, "/bai-viet");
  const html = renderArchive(req, res, page);
  if (!html) return next(notFound());
  return res.send(html);
});

publicRouter.get("/bai-viet", htmlCache(60), (req, res) => {
  res.send(renderArchive(req, res, 1));
});

function renderCategory(req, res, next, category, page) {
  const result = listPublished({ categorySlug: category.slug, perPage: 8, page });
  if (page > result.totalPages) return next(notFound());
  const base = `/chuyen-muc/${category.slug}`;
  return renderCollection(req, res, {
    result,
    basePath: base,
    title: page > 1 ? `${category.name} — Trang ${page}` : category.name,
    heading: category.name,
    description: category.description,
    activeCategorySlug: category.slug,
    activeGroup: category.group_name,
    crumbs: [{ label: "Trang chủ", href: "/" }, { label: category.name, href: page > 1 ? base : null }],
    jsonLd:
      page === 1
        ? [
            collectionLd({
              name: category.name,
              description: category.description,
              url: base,
              items: result.items,
            }),
            breadcrumbLd([
              { name: "Trang chủ", url: "/" },
              { name: category.name, url: base },
            ]),
          ]
        : [],
    emptyTitle: "Chuyên mục chưa có bài",
    emptyMessage: "Bài viết mới sẽ xuất hiện ở đây khi được đăng.",
  });
}

publicRouter.get("/chuyen-muc/:slug/trang/:page", htmlCache(120), (req, res, next) => {
  const page = pageNumber(req.params.page);
  if (!page) return next(notFound());
  const category = getCategoryBySlug(req.params.slug);
  if (!category) return next(notFound("Chuyên mục không tồn tại"));
  if (page === 1) return res.redirect(301, `/chuyen-muc/${category.slug}`);
  return res.send(renderCategory(req, res, next, category, page));
});

publicRouter.get("/chuyen-muc/:slug", htmlCache(120), (req, res, next) => {
  const category = getCategoryBySlug(req.params.slug);
  if (!category) return next(notFound("Chuyên mục không tồn tại"));
  return res.send(renderCategory(req, res, next, category, 1));
});

function groupKeyFromSlug(slug) {
  return Object.keys(GROUP_META).find((key) => GROUP_META[key].slug === slug) || null;
}

function renderGroup(req, res, next, key, page) {
  const meta = GROUP_META[key];
  const base = `/nhom/${meta.slug}`;
  const result = listPublished({ groupSlug: key, perPage: 8, page });
  if (page > result.totalPages) return next(notFound());
  const description =
    key === "tech"
      ? "Mẹo xử lý wifi chậm, điện thoại lag và bảo vệ tài khoản — làm được ngay tại nhà."
      : "Mẹo nhà cửa, ăn uống, sức khỏe và những việc nhỏ mỗi ngày làm nhẹ cuộc sống.";
  return renderCollection(req, res, {
    result,
    basePath: base,
    title: page > 1 ? `${meta.name} — Trang ${page}` : meta.name,
    heading: meta.name,
    description,
    activeGroup: key,
    crumbs: [{ label: "Trang chủ", href: "/" }, { label: meta.name, href: page > 1 ? base : null }],
    jsonLd:
      page === 1
        ? [
            collectionLd({ name: meta.name, description, url: base, items: result.items }),
            breadcrumbLd([
              { name: "Trang chủ", url: "/" },
              { name: meta.name, url: base },
            ]),
          ]
        : [],
  });
}

publicRouter.get("/nhom/:group/trang/:page", htmlCache(120), (req, res, next) => {
  const page = pageNumber(req.params.page);
  const key = groupKeyFromSlug(req.params.group);
  if (!key || !page) return next(notFound());
  if (page === 1) return res.redirect(301, `/nhom/${GROUP_META[key].slug}`);
  return res.send(renderGroup(req, res, next, key, page));
});

publicRouter.get("/nhom/:group", htmlCache(120), (req, res, next) => {
  const key = groupKeyFromSlug(req.params.group);
  if (!key) return next(notFound("Nhóm chuyên mục không tồn tại"));
  return res.send(renderGroup(req, res, next, key, 1));
});

function renderTag(req, res, next, tag, page) {
  const base = `/the/${tag.slug}`;
  const result = listPublished({ tagSlug: tag.slug, perPage: 8, page });
  if (page > result.totalPages) return next(notFound());
  return renderCollection(req, res, {
    result,
    basePath: base,
    title: page > 1 ? `Thẻ: ${tag.name} — Trang ${page}` : `Thẻ: ${tag.name}`,
    heading: `#${tag.name}`,
    description: `Các bài viết được gắn thẻ ${tag.name}.`,
    crumbs: [{ label: "Trang chủ", href: "/" }, { label: tag.name, href: page > 1 ? base : null }],
    jsonLd:
      page === 1
        ? [
            breadcrumbLd([
              { name: "Trang chủ", url: "/" },
              { name: tag.name, url: base },
            ]),
          ]
        : [],
  });
}

publicRouter.get("/the/:slug/trang/:page", htmlCache(120), (req, res, next) => {
  const page = pageNumber(req.params.page);
  if (!page) return next(notFound());
  const tag = getTagBySlug(req.params.slug);
  if (!tag) return next(notFound("Thẻ không tồn tại"));
  if (page === 1) return res.redirect(301, `/the/${tag.slug}`);
  return res.send(renderTag(req, res, next, tag, page));
});

publicRouter.get("/the/:slug", htmlCache(120), (req, res, next) => {
  const tag = getTagBySlug(req.params.slug);
  if (!tag) return next(notFound("Thẻ không tồn tại"));
  return res.send(renderTag(req, res, next, tag, 1));
});

publicRouter.get("/tim-kiem", (req, res) => {
  const ctx = res.locals;
  const q = String(req.query.q || "").trim().slice(0, 100);
  const page = pageNumber(req.query.page) || 1;
  const result = listPublished({ q, perPage: 8, page });
  res.setHeader("Cache-Control", "no-store");
  return res.send(renderList(ctx, {
    title: q ? `Tìm kiếm: ${q}` : "Tìm kiếm bài viết",
    heading: q ? `Kết quả cho “${q}”` : "Tìm kiếm bài viết",
    description: q ? `${result.total} kết quả cho từ khóa ${q}.` : "Tìm bài viết theo tiêu đề và nội dung.",
    posts: result.items,
    total: result.total,
    page,
    totalPages: result.totalPages,
    hrefFor: (n) => searchUrl(q, n),
    canonicalPath: searchUrl(q, page),
    noindex: true,
    searchQuery: q,
    popular: listPopular(5),
    crumbs: [{ label: "Trang chủ", href: "/" }, { label: "Tìm kiếm" }],
    emptyTitle: q ? "Không tìm thấy bài phù hợp" : "Nhập từ khóa để tìm bài viết",
    emptyMessage: q
      ? "Thử từ khóa ngắn hơn, hoặc xem theo chuyên mục ở menu."
      : "Bạn có thể tìm theo vấn đề, ví dụ: wifi chậm, khử mùi, mất ngủ.",
  }));
});

function renderGone(res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).send(
    renderError(res.locals, {
      status: 410,
      title: "Bài viết đã bị xóa",
      message: "Nội dung này đã được gỡ khỏi blog.",
      latest: listPublished({ perPage: 4 }).items,
    }),
  );
}

publicRouter.get("/bai-viet/:slug", articleEnumerationGuard, (req, res, next) => {
  const ctx = res.locals;
  const slug = String(req.params.slug || "");
  const post = getPublishedBySlug(slug);
  if (!post) {
    if (getTrashedBySlug(slug)) return renderGone(res);
    const history = findHistoricalSlug(slug);
    if (history) {
      if (history.deleted_at) return renderGone(res);
      return res.redirect(301, `/bai-viet/${encodeURIComponent(history.current_slug)}`);
    }
    return next(notFound("Bài viết không tồn tại"));
  }

  const prefetch =
    /prefetch|prerender/i.test(req.get("purpose") || "") ||
    /prefetch|prerender/i.test(req.get("sec-purpose") || "");
  if (!req.skipViewCount && !prefetch) incrementViews(post.id);

  post.tags = tagsFor(post.id);
  const related = listRelated(post, 4);
  const { prev, next: nextPost } = adjacentPosts(post);
  const jsonLd = [
    articleLd(post, ctx.settings),
    breadcrumbLd([
      { name: "Trang chủ", url: "/" },
      ...(post.category_slug
        ? [{ name: post.category_name, url: `/chuyen-muc/${post.category_slug}` }]
        : []),
      { name: post.title, url: `/bai-viet/${post.slug}` },
    ]),
  ];
  res.setHeader("Cache-Control", cacheSeconds(60));
  res.send(renderArticle(ctx, { post, related, prev, next: nextPost, jsonLd }));
});
