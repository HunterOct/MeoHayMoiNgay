import { esc } from "./helpers.js";
import { renderPage } from "./layout.js";
import { cardHTML, categorySidebarHTML, emptyHTML } from "./components.js";

export function renderError(ctx, { status, title, message, latest = [], detail = "" }) {
  const content = `<div class="wrap error-page">
    <div class="error-card" role="alert">
      <div class="error-code">${status}</div>
      <h1>${esc(title)}</h1>
      <p>${esc(message)}</p>
      ${detail ? `<p class="error-detail">${esc(detail)}</p>` : ""}
      <div class="error-actions">
        <a class="btn-ghost" href="/">← Về trang chủ</a>
      </div>
    </div>
    <div class="error-help">
      <div class="widget">
        <h2>Chuyên mục</h2>
        <div class="wline"></div>
        <ul class="catlist">${categorySidebarHTML(ctx.chrome.categories)}</ul>
      </div>
    </div>
    ${
      latest.length
        ? `<section aria-label="Bài mới"><div class="sec-head"><h2>Bài mới nhất</h2><div class="line"></div></div><div class="post-grid">${latest.map(cardHTML).join("")}</div></section>`
        : emptyHTML()
    }
  </div>`;

  return renderPage(ctx, {
    title,
    description: message,
    canonicalPath: null,
    noindex: true,
    content,
  });
}
