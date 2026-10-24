import { esc, absUrl, categoryUrl, groupUrl, serializeJsonLd } from "./helpers.js";
import { GROUP_META } from "./constants.js";
import { asset } from "../lib/assets.js";

function head(ctx, opts) {
  const { settings, siteUrl } = ctx;
  const siteName = settings.site_name;
  const title = opts.fullTitle ? opts.title : opts.title ? `${opts.title} — ${siteName}` : siteName;
  const description = opts.description || settings.site_description;
  const canonical = opts.canonicalPath ? absUrl(opts.canonicalPath) : "";
  const ogImage = opts.ogImage ? (opts.ogImage.startsWith("http") ? opts.ogImage : absUrl(opts.ogImage)) : "";
  const robots = opts.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large";
  const jsonLd = (opts.jsonLd || []).filter(Boolean);
  const preload = opts.preloadImage
    ? `<link rel="preload" as="image" href="${esc(opts.preloadImage)}" fetchpriority="high" />`
    : "";
  return `<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#143d29" />
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${robots}" />
    ${canonical ? `<link rel="canonical" href="${esc(canonical)}" />` : ""}
    <meta property="og:site_name" content="${esc(siteName)}" />
    <meta property="og:locale" content="vi_VN" />
    <meta property="og:type" content="${esc(opts.ogType || "website")}" />
    <meta property="og:title" content="${esc(opts.title || siteName)}" />
    <meta property="og:description" content="${esc(description)}" />
    ${canonical ? `<meta property="og:url" content="${esc(canonical)}" />` : ""}
    ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}" /><meta name="twitter:image" content="${esc(ogImage)}" />` : ""}
    <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${esc(opts.title || siteName)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <title>${esc(title)}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="alternate" type="application/rss+xml" title="${esc(siteName)} RSS" href="/rss.xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="${asset("/assets/css/style.css")}" />
    <link rel="stylesheet" href="${asset("/assets/css/site.css")}" />
    ${preload}
    ${opts.extraHead || ""}
    <script nonce="${ctx.nonce}">(function(){try{var s=localStorage.getItem("mh-theme");var t=s||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();</script>
    ${jsonLd.map((data) => `<script type="application/ld+json" nonce="${ctx.nonce}">${serializeJsonLd(data)}</script>`).join("\n")}
  </head>`;
}

function nav(ctx, opts) {
  const categories = ctx.chrome.categories;
  const groups = new Map();
  for (const category of categories) {
    if (!groups.has(category.group_name)) groups.set(category.group_name, []);
    groups.get(category.group_name).push(category);
  }
  const groupHtml = [...groups.entries()]
    .map(([key, list]) => {
      const meta = GROUP_META[key] || { name: key, slug: key };
      const active = opts.activeGroup === key || list.some((c) => c.slug === opts.activeCategorySlug);
      return `<div class="navdrop" data-group="${esc(key)}">
        <a class="drop-btn${active ? " active" : ""}" href="${groupUrl(meta)}" aria-haspopup="true" aria-expanded="false">${esc(meta.name)}
          <svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </a>
        <div class="drop-panel" role="menu" aria-label="Chuyên mục ${esc(meta.name)}">
          <div class="drop-grid">
            ${list
              .map(
                (category) =>
                  `<a class="drop-item${opts.activeCategorySlug === category.slug ? " active" : ""}" role="menuitem" href="${categoryUrl(category)}"><span>${esc(category.name)}</span><span class="n">${category.post_count ?? 0}</span></a>`,
              )
              .join("")}
          </div>
        </div>
      </div>`;
    })
    .join("");

  return `<nav class="navbar" aria-label="Chuyên mục và tìm kiếm">
    <div class="wrap">
      <div class="navlinks" id="navlinks">
        <a href="/"${opts.isHome ? ' class="active"' : ""}>Trang chủ</a>
        ${groupHtml}
        <a href="/bai-viet"${opts.activeAll ? ' class="active"' : ""}>Tất cả bài</a>
      </div>
      <form class="navsearch" role="search" action="/tim-kiem" method="get">
        <label class="box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="searchInput" type="search" name="q" placeholder="Tìm bài viết…" aria-label="Tìm bài viết" value="${esc(opts.searchQuery || "")}" />
        </label>
        <button class="search-submit" type="submit">Tìm</button>
      </form>
    </div>
  </nav>`;
}

function footer(ctx) {
  const { settings, chrome } = ctx;
  const groups = new Map();
  for (const category of chrome.categories) {
    if (!groups.has(category.group_name)) groups.set(category.group_name, []);
    groups.get(category.group_name).push(category);
  }
  const catColumns = [...groups.entries()]
    .map(
      ([key, list]) => `<div>
        <h5>${esc(GROUP_META[key]?.name || key)}</h5>
        <ul>${list.map((category) => `<li><a href="${categoryUrl(category)}">${esc(category.name)}</a></li>`).join("")}</ul>
      </div>`,
    )
    .join("");
  return `<footer>
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <a class="brand" href="/">Mẹo Hay <em>Mỗi Ngày</em></a>
          <p>${esc(settings.site_description)}</p>
          <p class="foot-feeds"><a href="/rss.xml">RSS</a> · <a href="/sitemap.xml">Sitemap</a></p>
        </div>
        <div class="foot-cats">${catColumns}</div>
        <div>
          <h5>Bài mới nhất</h5>
          <ul>${chrome.latest.map((post) => `<li><a href="/bai-viet/${encodeURIComponent(post.slug)}">${esc(post.title)}</a></li>`).join("")}</ul>
        </div>
      </div>
      <div class="foot-bottom">
        <span>© ${new Date().getFullYear()} ${esc(settings.site_name)}</span>
        <span>${esc(settings.copyright)} Nội dung chỉ để tham khảo — kiểm tra lại cài đặt trên thiết bị của bạn trước khi thay đổi. <a href="/admin" rel="nofollow">Quản trị</a></span>
      </div>
    </div>
  </footer>`;
}

export function renderPage(ctx, opts) {
  return `<!doctype html>
<html lang="vi">
  ${head(ctx, opts)}
  <body${opts.bodyClass ? ` class="${esc(opts.bodyClass)}"` : ""}>
    <div id="progress" aria-hidden="true"></div>
    <a class="skip-link" href="#main-content">Bỏ qua điều hướng</a>
    <div class="topstrip">
      <div class="wrap">
        <span>${esc(ctx.settings.site_tagline)}</span>
        <span class="top-right"><span>Bài mới mỗi ngày</span><button id="themeToggle" class="theme-toggle" type="button" aria-label="Đổi giao diện sáng tối" aria-pressed="false"><span class="toggle-track"><span class="toggle-icon moon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg></span><span class="toggle-icon sun"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span><span class="toggle-knob"></span></span></button></span>
      </div>
    </div>
    <header class="masthead">
      <div class="wrap">
        <a class="brand" href="/">Mẹo Hay <em>Mỗi Ngày</em></a>
        <p class="tagline">${esc(ctx.settings.site_tagline)}</p>
        <div class="rule" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3c2 3.5 2 7 0 10-2-3-2-6.5 0-10Z"/><path d="M12 13v8M7 21h10"/></svg>
        </div>
      </div>
    </header>
    ${nav(ctx, opts)}
    <main id="main-content">${opts.content}</main>
    ${footer(ctx)}
    <script src="${asset("/assets/js/site.js")}" defer nonce="${ctx.nonce}"></script>
  </body>
</html>`;
}
