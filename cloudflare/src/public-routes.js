import { config } from "./config.js";
import { GROUP_META } from "./views/constants.js";
import { pagedUrl, searchUrl } from "./views/helpers.js";
import { renderHome } from "./views/home.js";
import { renderList } from "./views/list.js";
import { renderArticle } from "./views/article.js";
import { renderError } from "./views/error.js";
import { articleLd, breadcrumbLd, collectionLd, organizationLd, websiteLd } from "./lib/seo.js";
import {
  adjacentPosts,
  categoriesForGroup,
  countPublished,
  findHistoricalSlug,
  getCategoryBySlug,
  getPublishedBySlug,
  getTagBySlug,
  getTrashedBySlug,
  listCategoriesFast,
  listLatest,
  listPopular,
  listPublished,
  listRelated,
} from "./public-data.js";
import { robotsTxt, rssXml, sitemapXml, websiteSettings } from "./feeds.js";
import { getSettings } from "./settings.js";
import {
  applyHtmlCache,
  applyNoStore,
  applySecurityHeaders,
  isBlockedUserAgent,
  newNonce,
} from "./security.js";

const PAGE_SIZE = 8;
const HOME_SIZE = 16;
const PUBLIC_WINDOW_MS = 60_000;
const publicBuckets = new Map();
const SEARCH_BOT_UA = /Googlebot|bingbot|DuckDuckBot|Applebot(?!-Extended)|YandexBot/i;

function publicRateLimit(c) {
  const ua = c.req.header("user-agent") || "";
  if (SEARCH_BOT_UA.test(ua)) return null;
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const path = c.req.path;
  const isSearch = path === "/tim-kiem";
  const isFeed = path === "/sitemap.xml" || path === "/rss.xml";
  const max = isSearch ? 30 : isFeed ? 60 : 120;
  const key = `${ip}:${isSearch ? "search" : isFeed ? "feed" : "html"}`;
  const now = Date.now();
  let bucket = publicBuckets.get(key);
  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + PUBLIC_WINDOW_MS };
    publicBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (publicBuckets.size > 5000) {
    for (const [cacheKey, entry] of publicBuckets) if (entry.reset <= now) publicBuckets.delete(cacheKey);
    if (publicBuckets.size > 5000) publicBuckets.clear();
  }
  if (bucket.count > max) {
    c.header("Retry-After", String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
    return 429;
  }
  return null;
}

function pageParam(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 1 ? number : null;
}

function groupKeyFromSlug(slug) {
  return Object.keys(GROUP_META).find((key) => GROUP_META[key].slug === slug) || null;
}

function crumbs(items) {
  return items;
}

async function buildContext(c, nonce, { categories = null, latest = null } = {}) {
  const [resolvedCategories, resolvedLatest] = await Promise.all([
    categories ? Promise.resolve(categories) : listCategoriesFast(c.env.DB),
    latest ? Promise.resolve(latest) : listLatest(c.env.DB, 5),
  ]);
  return {
    settings: await getSettings(c.env.DB).catch(() => websiteSettings()),
    chrome: {
      categories: resolvedCategories,
      latest: resolvedLatest.slice(0, 5),
      groups: [...new Set(resolvedCategories.map((category) => category.group_name))],
    },
    nonce,
    siteUrl: config.siteUrl,
  };
}

function blocked(c, reason) {
  applyNoStore(c);
  c.header("X-Robots-Tag", "noindex");
  return c.text(
    reason === "ai" ? "Crawler không được phép truy cập nội dung này." : "Truy cập tự động không được phép.",
    403,
  );
}

async function htmlPage(c, render, { noStore = false } = {}) {
  const reason = isBlockedUserAgent(c.req.header("user-agent"), c.get("allowAi") === true);
  if (reason) return blocked(c, reason);
  const nonce = newNonce();
  applySecurityHeaders(c, nonce);
  if (noStore) applyNoStore(c);
  else applyHtmlCache(c);
  const ctx = await render.ctx(c, nonce);
  return c.html(await render.body(ctx), render.status || 200);
}

async function errorResponse(c, status, title, message) {
  const nonce = newNonce();
  applySecurityHeaders(c, nonce);
  applyNoStore(c);
  c.header("X-Robots-Tag", "noindex");
  const [categories, latest] = await Promise.all([listCategoriesFast(c.env.DB), listLatest(c.env.DB, 4)]);
  const ctx = await buildContext(c, nonce, { categories, latest });
  return c.html(renderError(ctx, { status, title, message, latest }), status);
}

export function registerPublicRoutes(app) {
  app.use("*", async (c, next) => {
    if (publicRateLimit(c) === 429) {
      return c.text("Bạn truy cập quá nhanh. Vui lòng thử lại sau.", 429);
    }
    const settings = await getSettings(c.env.DB).catch(() => websiteSettings());
    c.set("allowAi", settings.allow_ai_crawlers === "1");
    await next();
  });

  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    let path = url.pathname;
    if (path !== "/" && path.endsWith("/")) {
      path = path.replace(/\/+$/, "");
      return c.redirect(`${path}${url.search}`, 301);
    }
    if (path.endsWith(".html")) {
      const clean = path === "/index.html" ? "/" : path.slice(0, -5);
      return c.redirect(`${clean}${url.search}`, 301);
    }
    await next();
  });

  app.get("/", async (c) => {
    const reason = isBlockedUserAgent(c.req.header("user-agent"), c.get("allowAi") === true);
    if (reason) return blocked(c, reason);
    const nonce = newNonce();
    applySecurityHeaders(c, nonce);
    applyHtmlCache(c);
    const [latest, popular, categories] = await Promise.all([
      listLatest(c.env.DB, HOME_SIZE),
      listPopular(c.env.DB, 5),
      listCategoriesFast(c.env.DB),
    ]);
    const ctx = await buildContext(c, nonce, { categories, latest });
    return c.html(
      renderHome(ctx, {
        slides: latest.slice(0, 5),
        side: latest.slice(5, 10),
        thumbs: latest.slice(10, 16),
        grid: latest.slice(0, 8),
        popular,
        jsonLd: [websiteLd(ctx.settings), organizationLd(ctx.settings)],
      }),
    );
  });

  app.get("/bai-viet/trang/:page", async (c) => {
    const page = pageParam(c.req.param("page"));
    if (!page) return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
    if (page === 1) return c.redirect("/bai-viet", 301);
    const total = await countPublished(c.env.DB);
    const result = await listPublished(c.env.DB, { perPage: PAGE_SIZE, page, total });
    if (page > result.totalPages) {
      return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
    }
    return htmlPage(c, {
      ctx: async (request, nonce) => {
        const [popular, categories, latest] = await Promise.all([
          listPopular(request.env.DB, 5),
          listCategoriesFast(request.env.DB),
          listLatest(request.env.DB, 5),
        ]);
        const ctx = await buildContext(request, nonce, { categories, latest });
        return { ctx, result, popular };
      },
      body: ({ ctx, result, popular }) =>
        renderList(ctx, {
          title: `Tất cả bài viết — Trang ${page}`,
          heading: "Tất cả bài viết",
          description: "Toàn bộ mẹo vặt đời sống và công nghệ, mới nhất trước.",
          posts: result.items,
          total: result.total,
          page,
          totalPages: result.totalPages,
          hrefFor: (n) => pagedUrl("/bai-viet", n),
          canonicalPath: pagedUrl("/bai-viet", page),
          activeAll: true,
          crumbs: crumbs([{ label: "Trang chủ", href: "/" }, { label: "Tất cả bài viết" }]),
          popular,
          emptyTitle: "Chưa có bài viết nào",
          emptyMessage: "Bài viết sẽ xuất hiện ở đây ngay khi được đăng.",
        }),
    });
  });

  app.get("/bai-viet", async (c) => {
    const total = await countPublished(c.env.DB);
    const result = await listPublished(c.env.DB, { perPage: PAGE_SIZE, page: 1, total });
    return htmlPage(c, {
      ctx: async (request, nonce) => {
        const [popular, categories, latest] = await Promise.all([
          listPopular(request.env.DB, 5),
          listCategoriesFast(request.env.DB),
          listLatest(request.env.DB, 5),
        ]);
        const ctx = await buildContext(request, nonce, { categories, latest });
        return { ctx, result, popular };
      },
      body: ({ ctx, result, popular }) =>
        renderList(ctx, {
          title: "Tất cả bài viết",
          heading: "Tất cả bài viết",
          description: "Toàn bộ mẹo vặt đời sống và công nghệ, mới nhất trước.",
          posts: result.items,
          total: result.total,
          page: 1,
          totalPages: result.totalPages,
          hrefFor: (n) => pagedUrl("/bai-viet", n),
          canonicalPath: "/bai-viet",
          activeAll: true,
          crumbs: crumbs([{ label: "Trang chủ", href: "/" }, { label: "Tất cả bài viết" }]),
          popular,
          jsonLd: [
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
          ],
          emptyTitle: "Chưa có bài viết nào",
          emptyMessage: "Bài viết sẽ xuất hiện ở đây ngay khi được đăng.",
        }),
    });
  });

  app.get("/bai-viet/:slug", async (c) => {
    const slug = String(c.req.param("slug") || "");
    const post = await getPublishedBySlug(c.env.DB, slug);
    if (!post) {
      const trashed = await getTrashedBySlug(c.env.DB, slug);
      if (trashed) return errorResponse(c, 410, "Bài viết đã bị xóa", "Nội dung này đã được gỡ khỏi blog.");
      const history = await findHistoricalSlug(c.env.DB, slug);
      if (history) {
        if (history.deleted_at) return errorResponse(c, 410, "Bài viết đã bị xóa", "Nội dung này đã được gỡ khỏi blog.");
        return c.redirect(`/bai-viet/${encodeURIComponent(history.current_slug)}`, 301);
      }
      return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
    }
    const [related, adjacent, categories, latest] = await Promise.all([
      listRelated(c.env.DB, post, 4),
      adjacentPosts(c.env.DB, post),
      listCategoriesFast(c.env.DB),
      listLatest(c.env.DB, 5),
    ]);
    return htmlPage(c, {
      ctx: async (request, nonce) => buildContext(request, nonce, { categories, latest }),
      body: (ctx) =>
        renderArticle(ctx, {
          post,
          related,
          prev: adjacent.prev,
          next: adjacent.next,
          jsonLd: [
            articleLd(post, ctx.settings),
            breadcrumbLd([
              { name: "Trang chủ", url: "/" },
              ...(post.category_slug
                ? [{ name: post.category_name, url: `/chuyen-muc/${encodeURIComponent(post.category_slug)}` }]
                : []),
              { name: post.title, url: `/bai-viet/${post.slug}` },
            ]),
          ],
        }),
    });
  });

  app.get("/chuyen-muc/:slug/trang/:page", async (c) => {
    const page = pageParam(c.req.param("page"));
    if (!page) return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
    const category = await getCategoryBySlug(c.env.DB, c.req.param("slug"));
    if (!category) return errorResponse(c, 404, "Chuyên mục không tồn tại", "Chuyên mục không tồn tại");
    if (page === 1) return c.redirect(`/chuyen-muc/${category.slug}`, 301);
    return categoryPage(c, category, page);
  });

  app.get("/chuyen-muc/:slug", async (c) => {
    const category = await getCategoryBySlug(c.env.DB, c.req.param("slug"));
    if (!category) return errorResponse(c, 404, "Chuyên mục không tồn tại", "Chuyên mục không tồn tại");
    return categoryPage(c, category, 1);
  });

  app.get("/nhom/:group/trang/:page", async (c) => {
    const page = pageParam(c.req.param("page"));
    const key = groupKeyFromSlug(c.req.param("group"));
    if (!key || !page) return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
    if (page === 1) return c.redirect(`/nhom/${GROUP_META[key].slug}`, 301);
    return groupPage(c, key, page);
  });

  app.get("/nhom/:group", async (c) => {
    const key = groupKeyFromSlug(c.req.param("group"));
    if (!key) return errorResponse(c, 404, "Nhóm chuyên mục không tồn tại", "Nhóm chuyên mục không tồn tại");
    return groupPage(c, key, 1);
  });

  app.get("/the/:slug/trang/:page", async (c) => {
    const page = pageParam(c.req.param("page"));
    if (!page) return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
    const tag = await getTagBySlug(c.env.DB, c.req.param("slug"));
    if (!tag) return errorResponse(c, 404, "Thẻ không tồn tại", "Thẻ không tồn tại");
    if (page === 1) return c.redirect(`/the/${tag.slug}`, 301);
    return tagPage(c, tag, page);
  });

  app.get("/the/:slug", async (c) => {
    const tag = await getTagBySlug(c.env.DB, c.req.param("slug"));
    if (!tag) return errorResponse(c, 404, "Thẻ không tồn tại", "Thẻ không tồn tại");
    return tagPage(c, tag, 1);
  });

  app.get("/tim-kiem", async (c) => {
    const ua = c.req.header("user-agent") || "";
    if (!SEARCH_BOT_UA.test(ua)) {
      const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
      const stub = c.env.SECURE_OPS.get(c.env.SECURE_OPS.idFromName("rate"));
      const limit = await stub.rateLimit(`search:${ip}`, 30, 60_000);
      c.header("X-RateLimit-Limit", "30");
      c.header("X-RateLimit-Remaining", String(limit.remaining));
      if (!limit.allowed) {
        c.header("Retry-After", String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))));
        applyNoStore(c);
        c.header("X-Robots-Tag", "noindex");
        return c.text("Bạn tìm kiếm quá nhanh. Vui lòng thử lại sau.", 429);
      }
    }
    const q = String(c.req.query("q") || "").trim().slice(0, 100);
    const page = pageParam(c.req.query("page")) || 1;
    const result = await listPublished(c.env.DB, { q, perPage: PAGE_SIZE, page });
    return htmlPage(
      c,
      {
        ctx: async (request, nonce) => {
          const [popular, categories, latest] = await Promise.all([
            listPopular(request.env.DB, 5),
            listCategoriesFast(request.env.DB),
            listLatest(request.env.DB, 5),
          ]);
          const ctx = await buildContext(request, nonce, { categories, latest });
          return { ctx, result, popular };
        },
        body: ({ ctx, result, popular }) =>
          renderList(ctx, {
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
            popular,
            crumbs: crumbs([{ label: "Trang chủ", href: "/" }, { label: "Tìm kiếm" }]),
            emptyTitle: q ? "Không tìm thấy bài phù hợp" : "Nhập từ khóa để tìm bài viết",
            emptyMessage: q
              ? "Thử từ khóa ngắn hơn, hoặc xem theo chuyên mục ở menu."
              : "Bạn có thể tìm theo vấn đề, ví dụ: wifi chậm, khử mùi, mất ngủ.",
          }),
      },
      { noStore: true },
    );
  });

  app.get("/sitemap.xml", async (c) => {
    applyNoStore(c);
    return c.body(await sitemapXml(c.env.DB), 200, { "content-type": "application/xml; charset=utf-8" });
  });

  app.get("/rss.xml", async (c) => {
    applyNoStore(c);
    const settings = await getSettings(c.env.DB).catch(() => websiteSettings());
    return c.body(await rssXml(c.env.DB, settings), 200, { "content-type": "application/rss+xml; charset=utf-8" });
  });

  app.get("/robots.txt", async (c) => {
    applyNoStore(c);
    const settings = await getSettings(c.env.DB).catch(() => websiteSettings());
    return c.body(robotsTxt(settings), 200, { "content-type": "text/plain; charset=utf-8" });
  });

  app.get("/feed", (c) => c.redirect("/rss.xml", 301));
  app.get("/feed.xml", (c) => c.redirect("/rss.xml", 301));
}

async function categoryPage(c, category, page) {
  const result = await listPublished(c.env.DB, {
    categoryId: category.id,
    perPage: PAGE_SIZE,
    page,
    total: category.cached_post_count,
  });
  if (page > result.totalPages) {
    return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
  }
  const base = `/chuyen-muc/${category.slug}`;
  return htmlPage(c, {
    ctx: async (request, nonce) => {
      const [popular, categories, latest] = await Promise.all([
        listPopular(request.env.DB, 5),
        listCategoriesFast(request.env.DB),
        listLatest(request.env.DB, 5),
      ]);
      const ctx = await buildContext(request, nonce, { categories, latest });
      return { ctx, result, popular };
    },
    body: ({ ctx, result, popular }) =>
      renderList(ctx, {
        title: page > 1 ? `${category.name} — Trang ${page}` : category.name,
        heading: category.name,
        description: category.description,
        posts: result.items,
        total: result.total,
        page,
        totalPages: result.totalPages,
        hrefFor: (n) => pagedUrl(base, n),
        canonicalPath: page > 1 ? pagedUrl(base, page) : base,
        activeCategorySlug: category.slug,
        activeGroup: category.group_name,
        crumbs: crumbs([
          { label: "Trang chủ", href: "/" },
          { label: category.name, href: page > 1 ? base : null },
        ]),
        popular,
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
      }),
  });
}

async function groupPage(c, key, page) {
  const meta = GROUP_META[key];
  const base = `/nhom/${meta.slug}`;
  const groupCategories = await categoriesForGroup(c.env.DB, key);
  const total = groupCategories.reduce((sum, item) => sum + Number(item.cached_post_count || 0), 0);
  const result = await listPublished(c.env.DB, {
    groupCategoryIds: groupCategories.map((item) => item.id),
    perPage: PAGE_SIZE,
    page,
    total,
  });
  if (page > result.totalPages) {
    return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
  }
  const description =
    key === "tech"
      ? "Mẹo xử lý wifi chậm, điện thoại lag và bảo vệ tài khoản — làm được ngay tại nhà."
      : "Mẹo nhà cửa, ăn uống, sức khỏe và những việc nhỏ mỗi ngày làm nhẹ cuộc sống.";
  return htmlPage(c, {
    ctx: async (request, nonce) => {
      const [popular, categories, latest] = await Promise.all([
        listPopular(request.env.DB, 5),
        listCategoriesFast(request.env.DB),
        listLatest(request.env.DB, 5),
      ]);
      const ctx = await buildContext(request, nonce, { categories, latest });
      return { ctx, result, popular };
    },
    body: ({ ctx, result, popular }) =>
      renderList(ctx, {
        title: page > 1 ? `${meta.name} — Trang ${page}` : meta.name,
        heading: meta.name,
        description,
        posts: result.items,
        total: result.total,
        page,
        totalPages: result.totalPages,
        hrefFor: (n) => pagedUrl(base, n),
        canonicalPath: page > 1 ? pagedUrl(base, page) : base,
        activeGroup: key,
        crumbs: crumbs([
          { label: "Trang chủ", href: "/" },
          { label: meta.name, href: page > 1 ? base : null },
        ]),
        popular,
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
      }),
  });
}

async function tagPage(c, tag, page) {
  const base = `/the/${tag.slug}`;
  const result = await listPublished(c.env.DB, {
    tagSlug: tag.slug,
    perPage: PAGE_SIZE,
    page,
    total: tag.cached_post_count,
  });
  if (page > result.totalPages) {
    return errorResponse(c, 404, "Không tìm thấy trang", "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.");
  }
  return htmlPage(c, {
    ctx: async (request, nonce) => {
      const [popular, categories, latest] = await Promise.all([
        listPopular(request.env.DB, 5),
        listCategoriesFast(request.env.DB),
        listLatest(request.env.DB, 5),
      ]);
      const ctx = await buildContext(request, nonce, { categories, latest });
      return { ctx, result, popular };
    },
    body: ({ ctx, result, popular }) =>
      renderList(ctx, {
        title: page > 1 ? `Thẻ: ${tag.name} — Trang ${page}` : `Thẻ: ${tag.name}`,
        heading: `#${tag.name}`,
        description: `Các bài viết được gắn thẻ ${tag.name}.`,
        posts: result.items,
        total: result.total,
        page,
        totalPages: result.totalPages,
        hrefFor: (n) => pagedUrl(base, n),
        canonicalPath: page > 1 ? pagedUrl(base, page) : base,
        crumbs: crumbs([{ label: "Trang chủ", href: "/" }, { label: tag.name, href: page > 1 ? base : null }]),
        popular,
        jsonLd:
          page === 1
            ? [
                breadcrumbLd([
                  { name: "Trang chủ", url: "/" },
                  { name: tag.name, url: base },
                ]),
              ]
            : [],
      }),
  });
}

export { errorResponse, buildContext };
