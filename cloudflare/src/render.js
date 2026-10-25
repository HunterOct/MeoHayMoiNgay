const SITE_NAME = "Mẹo Hay Mỗi Ngày";

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const abs = (siteUrl, path) => new URL(path, siteUrl).toString();

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateVN = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
};

const initial = (name) => String(name || "?").trim().charAt(0).toUpperCase();

const jsonLd = (data) => JSON.stringify(data).replace(/</g, "\\u003c");

function head({ title, description, canonical, image, type = "website", noindex = false, fullTitle = false }) {
  return `<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#143d29" />
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <meta property="og:site_name" content="${esc(SITE_NAME)}" />
    <meta property="og:locale" content="vi_VN" />
    <meta property="og:type" content="${type}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    ${image ? `<meta property="og:image" content="${esc(image)}" /><meta name="twitter:image" content="${esc(image)}" />` : ""}
    <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <title>${esc(fullTitle ? title : `${title} — ${SITE_NAME}`)}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)} RSS" href="/rss.xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/assets/css/style.css?v=m0" />
    <link rel="stylesheet" href="/assets/css/site.css?v=m0" />
    <script>(function(){try{var s=localStorage.getItem("mh-theme");var t=s||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();</script>
  </head>`;
}

function chrome(content, { active = "" } = {}) {
  const nav = (label, href, key) =>
    `<a href="${href}"${active === key ? ' class="active"' : ""}>${label}</a>`;
  return `<div class="topstrip"><div class="wrap"><span>Mẹo vặt đời sống &amp; công nghệ — dễ làm, không tốn tiền</span><span class="top-right"><span>Bài mới mỗi ngày</span><button id="themeToggle" class="theme-toggle" type="button" aria-label="Đổi giao diện sáng tối" aria-pressed="false"><span class="toggle-track"><span class="toggle-icon moon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg></span><span class="toggle-icon sun"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span><span class="toggle-knob"></span></span></button></span></div></div>
    <header class="masthead"><div class="wrap"><a class="brand" href="/">Mẹo Hay <em>Mỗi Ngày</em></a><p class="tagline">Mỗi bài một vấn đề quen thuộc — nhà cửa, sức khỏe, ăn uống, wifi, điện thoại — giải quyết từng bước trong vài phút.</p><div class="rule" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3c2 3.5 2 7 0 10-2-3-2-6.5 0-10Z"/><path d="M12 13v8M7 21h10"/></svg></div></div></header>
    <nav class="navbar" aria-label="Chuyên mục và tìm kiếm"><div class="wrap"><div class="navlinks" id="navlinks">${nav("Trang chủ", "/", "home")}${nav("Đời sống", "/nhom/doi-song", "life")}${nav("Công nghệ", "/nhom/cong-nghe", "tech")}${nav("Tất cả bài", "/bai-viet", "all")}</div><form class="navsearch" role="search" action="/tim-kiem" method="get"><label class="box"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="searchInput" type="search" name="q" placeholder="Tìm bài viết…" aria-label="Tìm bài viết" /></label><button class="search-submit" type="submit">Tìm</button></form></div></nav>
    <main id="main-content">${content}</main>
    <footer><div class="wrap"><div class="foot-grid"><div><a class="brand" href="/">Mẹo Hay <em>Mỗi Ngày</em></a><p>Blog mẹo vặt đời sống &amp; công nghệ: mỗi bài một vấn đề, hướng dẫn từng bước để ai cũng tự làm được tại nhà.</p><p class="foot-feeds"><a href="/rss.xml">RSS</a> · <a href="/sitemap.xml">Sitemap</a></p></div><div class="foot-cats"><div class="glabel">Đời sống</div><ul><li><a href="/chuyen-muc/meo-vat">Mẹo vặt</a></li><li><a href="/chuyen-muc/nha-cua">Nhà cửa</a></li><li><a href="/chuyen-muc/suc-khoe">Sức khỏe</a></li><li><a href="/chuyen-muc/an-uong">Ăn uống</a></li></ul><div class="glabel">Công nghệ</div><ul><li><a href="/chuyen-muc/wifi-mang">Wifi &amp; Mạng</a></li><li><a href="/chuyen-muc/dien-thoai">Điện thoại</a></li><li><a href="/chuyen-muc/bao-mat">Bảo mật</a></li></ul></div><div><h5>Bài mới nhất</h5><ul><li><a href="/bai-viet/wifi-nha-cham-7-cach-khac-phuc">Wifi nhà chậm, lag khi xem YouTube?</a></li><li><a href="/bai-viet/meo-vat-trong-nha-9-meo-nho">9 mẹo vặt trong nhà ai cũng nên biết</a></li><li><a href="/bai-viet/sap-xep-tu-lanh-5-buoc">Tủ lạnh lộn xộn, đồ ăn hay phải bỏ</a></li></ul></div></div><div class="foot-bottom"><span>© 2026 Mẹo Hay Mỗi Ngày</span><span>Nội dung và hình ảnh thuộc Mẹo Hay Mỗi Ngày, vui lòng không sao chép khi chưa được đồng ý.</span></div></div></footer>
    <script src="/assets/js/site.js" defer></script>`;
}

export function renderArticlePage(post, { siteUrl = "http://127.0.0.1:8787", related = [] } = {}) {
  const canonical = post.canonical_url || abs(siteUrl, `/bai-viet/${encodeURIComponent(post.slug)}`);
  const image = post.og_image || post.cover_image
    ? abs(siteUrl, post.og_image || post.cover_image)
    : "";
  const tags = post.tags || [];
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: abs(siteUrl, "/") },
      ...(post.category_name
        ? [{ "@type": "ListItem", position: 2, name: post.category_name, item: abs(siteUrl, `/chuyen-muc/${post.category_slug}`) }]
        : []),
      { "@type": "ListItem", position: 3, name: post.title, item: canonical },
    ],
  };
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.seo_title || post.title,
    description: post.seo_description || post.excerpt,
    image: image ? [image] : undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    inLanguage: "vi-VN",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    url: canonical,
    author: { "@type": "Person", name: post.author_name || "Bé Dâu" },
    publisher: { "@type": "Organization", name: SITE_NAME, url: abs(siteUrl, "/") },
    articleSection: post.category_name || undefined,
    keywords: tags.map((tag) => tag.name).join(", ") || undefined,
  };
  const relatedHtml = related
    .map(
      (item) => `<a class="post-card" href="/bai-viet/${encodeURIComponent(item.slug)}"><div class="thumb"><img src="${esc(item.cover_image)}" alt="${esc(item.cover_alt || item.title)}" width="980" height="735" loading="lazy" /></div><div class="body"><span class="chip">${esc(item.category_name || "")}</span><h3>${esc(item.title)}</h3><p>${esc(item.excerpt)}</p><span class="meta"><span>${dateVN(item.published_at)}</span><span class="dot"></span><span>${item.read_minutes || 4} phút đọc</span></span></div></a>`,
    )
    .join("");
  const content = `<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Trang chủ</a><span aria-hidden="true">›</span>${post.category_name ? `<a href="/chuyen-muc/${esc(post.category_slug)}">${esc(post.category_name)}</a><span aria-hidden="true">›</span>` : ""}<span>${esc(post.title)}</span></nav>
    <article class="article">
      <span class="chip">${esc(post.category_name || "Bài viết")}</span>
      <h1>${esc(post.title)}</h1>
      ${post.lede ? `<p class="lede">${esc(post.lede)}</p>` : ""}
      <div class="meta"><span class="avatar">${esc(initial(post.author_name))}</span><span>${esc(post.author_name || "Bé Dâu")}</span><span class="dot"></span><span>${dateVN(post.published_at)}</span><span class="dot"></span><span>${post.read_minutes || 4} phút đọc</span></div>
      ${post.cover_image ? `<figure class="heroimg"><img src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}" width="980" height="735" fetchpriority="high" /></figure>` : ""}
      ${post.cover_caption ? `<p class="caption">${esc(post.cover_caption)}</p>` : ""}
      <div class="prose">${post.content_html}</div>
      ${tags.length ? `<div class="taglist">${tags.map((tag) => `<a class="tag" href="/the/${esc(tag.slug)}" rel="tag">#${esc(tag.name)}</a>`).join("")}</div>` : ""}
      <div class="endmark" aria-hidden="true">❦</div>
      <div class="authorbox"><span class="avatar">${esc(initial(post.author_name))}</span><div><span class="an">${esc(post.author_name || "Bé Dâu")}</span><p>Người viết Mẹo Hay Mỗi Ngày — chuyên săn những mẹo vặt đời sống và trục trặc công nghệ trong nhà.</p></div></div>
    </article>
    ${relatedHtml ? `<section class="article"><div class="sec-head"><h2>Bài liên quan</h2><div class="line"></div></div><div class="post-grid">${relatedHtml}</div></section>` : ""}
  </div>`;
  return `<!doctype html>
<html lang="vi">
  ${head({
    title: post.seo_title || post.title,
    description: post.seo_description || post.excerpt,
    canonical,
    image,
    type: "article",
  })}
  <body>
    ${chrome(content, { active: post.category_group || "" })}
    <script type="application/ld+json">${jsonLd(articleLd)}</script>
    <script type="application/ld+json">${jsonLd(breadcrumb)}</script>
  </body>
</html>`;
}

export function renderHomePage(posts, categories, { siteUrl = "http://127.0.0.1:8787" } = {}) {
  const hero = posts.slice(0, 5);
  const side = posts.slice(5, 10);
  const cards = posts.slice(0, 8);
  const heroHtml = hero
    .map(
      (post, index) => `<div class="hero-slide${index === 0 ? " active" : ""}"><a class="hero-card" href="/bai-viet/${encodeURIComponent(post.slug)}"><span class="hero-media"><img src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}" width="980" height="735" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} /></span><span class="hero-body"><span class="kicker">Nổi bật · ${esc(post.category_name || "Bài mới")}</span><span class="hero-title">${esc(post.title)}</span><span class="hero-excerpt">${esc(post.excerpt)}</span><span class="meta"><span>${dateVN(post.published_at)}</span><span class="dot"></span><span>${post.read_minutes || 4} phút đọc</span></span><span class="readmore">Đọc bài →</span></span></a></div>`,
    )
    .join("");
  const sideHtml = side
    .map(
      (post, index) => `<a class="hero-side-post" href="/bai-viet/${encodeURIComponent(post.slug)}"><span class="num">0${index + 1}</span><img class="hero-side-thumb" src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}" width="72" height="54" loading="lazy" /><span><span class="t">${esc(post.title)}</span><span class="d">${dateVN(post.published_at)} · ${esc(post.category_name || "")}</span></span></a>`,
    )
    .join("");
  const cardHtml = cards
    .map(
      (post) => `<a class="post-card" href="/bai-viet/${encodeURIComponent(post.slug)}"><div class="thumb"><img src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}" width="980" height="735" loading="lazy" /></div><div class="body"><span class="chip">${esc(post.category_name || "")}</span><h3>${esc(post.title)}</h3><p>${esc(post.excerpt)}</p><span class="meta"><span>${dateVN(post.published_at)}</span><span class="dot"></span><span>${post.read_minutes || 4} phút đọc</span></span></div></a>`,
    )
    .join("");
  const categoryHtml = categories
    .map((category) => `<li><a href="/chuyen-muc/${esc(category.slug)}"><span>${esc(category.name)}</span></a></li>`)
    .join("");
  const content = `<div class="ticker wrap"><span class="ticker-label">TIN MỚI</span><a class="ticker-title" href="/bai-viet/${encodeURIComponent(posts[0]?.slug || "")}">${esc(posts[0]?.title || "Chưa có bài")}</a></div>
    <section class="hero-area wrap"><div class="hero-main"><div class="hero-slider">${heroHtml}</div></div><aside class="hero-side"><h3>Xem thêm</h3>${sideHtml}</aside></section>
    <div class="wrap"><div class="sec-head"><h2>Bài viết mới nhất</h2><div class="line"></div><span class="count">${cards.length} bài mới</span></div><div class="layout"><div><div class="post-grid">${cardHtml}</div></div><aside class="side"><div class="widget"><h4>Về blog này</h4><div class="wline"></div><p>Mẹo Hay Mỗi Ngày chia sẻ mẹo vặt cho cuộc sống hằng ngày: nhà cửa, bảo quản đồ ăn, ngủ ngon, wifi và điện thoại.</p></div><div class="widget"><h4>Chuyên mục</h4><div class="wline"></div><ul class="catlist">${categoryHtml}</ul></div></aside></div></div>`;
  return `<!doctype html>
<html lang="vi">
  ${head({ title: SITE_NAME, fullTitle: true, description: "Blog mẹo vặt đời sống và công nghệ, mỗi bài một vấn đề.", canonical: abs(siteUrl, "/") })}
  <body>${chrome(content, { active: "home" })}</body>
</html>`;
}

export { SITE_NAME };
