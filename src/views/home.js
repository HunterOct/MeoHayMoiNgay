import { esc } from "./helpers.js";
import { renderPage } from "./layout.js";
import {
  heroSlideHTML,
  heroSideHTML,
  thumbStripHTML,
  cardHTML,
  sidebarHTML,
  tipsBandHTML,
} from "./components.js";

export function renderHome(ctx, { slides, side, thumbs, grid, popular, jsonLd = [] }) {
  const tickerItems = slides;
  const content = `<div class="ticker wrap" role="region" aria-label="Tin mới">
      <span class="ticker-label">TIN MỚI</span>
      <a class="ticker-title" id="tickerTitle" href="${tickerItems.length ? `/bai-viet/${encodeURIComponent(tickerItems[0].slug)}` : "/bai-viet"}">${esc(tickerItems[0]?.title || "Chưa có bài nào")}</a>
      <span class="ticker-nav"><button type="button" id="tickerPrev" aria-label="Tin trước">‹</button><button type="button" id="tickerNext" aria-label="Tin sau">›</button></span>
      <div id="tickerData" hidden>
        ${tickerItems.map((post) => `<a href="/bai-viet/${encodeURIComponent(post.slug)}" data-title="${esc(post.title)}"></a>`).join("")}
      </div>
    </div>
    <section class="hero-area wrap" aria-label="Bài nổi bật">
      <div class="hero-main" id="heroSlot">
        <div class="hero-slider" id="heroSlider">
          ${slides.map((post, index) => heroSlideHTML(post, index, { eager: index === 0 })).join("")}
          ${slides.length > 1 ? `<button class="slider-nav prev" type="button" aria-label="Bài nổi bật trước">‹</button><button class="slider-nav next" type="button" aria-label="Bài nổi bật sau">›</button>` : ""}
        </div>
        ${slides.length > 1 ? `<div class="slider-dots" role="tablist" aria-label="Chọn bài nổi bật">${slides.map((_, index) => `<button class="slider-dot${index === 0 ? " active" : ""}" type="button" data-slide="${index}" aria-label="Bài ${index + 1}"></button>`).join("")}</div>` : ""}
      </div>
      <aside class="hero-side">
        <h3>Xem thêm</h3>
        ${heroSideHTML(side)}
      </aside>
    </section>
    <section class="thumb-strip wrap" id="thumbStrip" aria-label="Bài viết khác">${thumbStripHTML(thumbs)}</section>

    <div class="wrap">
      <div class="sec-head">
        <h2>Bài viết mới nhất</h2>
        <div class="line"></div>
        <span class="count">${grid.length} bài mới</span>
      </div>
      <div class="layout">
        <div>
          <div class="post-grid">${grid.map(cardHTML).join("")}</div>
          <div class="showall-row"><a class="btn-ghost" href="/bai-viet">Xem tất cả bài viết →</a></div>
        </div>
        ${sidebarHTML({ categories: ctx.chrome.categories, popular })}
      </div>
    </div>
    ${tipsBandHTML()}`;

  return renderPage(ctx, {
    fullTitle: true,
    title: `${ctx.settings.site_name} — ${ctx.settings.site_tagline}`,
    description: ctx.settings.site_description,
    canonicalPath: "/",
    ogType: "website",
    ogImage: slides[0]?.cover_image || "/assets/img/img-001.jpg",
    preloadImage: slides[0]?.cover_image || null,
    isHome: true,
    jsonLd,
    content,
  });
}
