import { esc, initial, postUrl, categoryUrl, tagUrl } from "./helpers.js";
import { imgDimsAttrs } from "../lib/image-meta.js";
import { formatDate } from "../lib/time.js";
import { CHECKLIST, TIPS, ABOUT_TEXT, GROUP_META } from "./constants.js";

export function metaHTML(post, { withAuthor = false } = {}) {
  const parts = [];
  if (withAuthor) {
    parts.push(
      `<span class="avatar" aria-hidden="true">${esc(initial(post.author_name))}</span><span>${esc(post.author_name || "Bé Dâu")}</span><span class="dot" aria-hidden="true"></span>`,
    );
  }
  parts.push(
    `<span>${esc(formatDate(post.published_at || post.created_at))}</span><span class="dot" aria-hidden="true"></span><span>${esc(post.read_minutes || 4)} phút đọc</span>`,
  );
  return `<span class="meta">${parts.join("")}</span>`;
}

function chip(post) {
  if (!post.category_name) return "";
  return `<span class="chip">${esc(post.category_name)}</span>`;
}

export function cardHTML(post) {
  return `<a class="post-card" href="${postUrl(post)}" aria-label="${esc(post.title)}">
    <div class="thumb"><img draggable="false" src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}"${imgDimsAttrs(post.cover_image)} loading="lazy" decoding="async" /></div>
    <div class="body">
      ${chip(post)}
      <h3>${esc(post.title)}</h3>
      <p>${esc(post.excerpt)}</p>
      ${metaHTML(post)}
    </div>
  </a>`;
}

export function catRowHTML(post) {
  return `<a class="cat-row" href="${postUrl(post)}" aria-label="${esc(post.title)}">
    <div class="cat-row-thumb">${chip(post)}<img draggable="false" src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}"${imgDimsAttrs(post.cover_image)} loading="lazy" decoding="async" /></div>
    <div class="cat-row-body">
      <h3>${esc(post.title)}</h3>
      ${metaHTML(post, { withAuthor: true })}
      <p>${esc(post.excerpt)}</p>
      <span class="readmore-btn">ĐỌC BÀI</span>
    </div>
  </a>`;
}

export function heroSlideHTML(post, index, { eager = false } = {}) {
  return `<div class="hero-slide${index === 0 ? " active" : ""}">
    <a class="hero-card" href="${postUrl(post)}" aria-label="${esc(post.title)}">
      <span class="hero-media"><img draggable="false" src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}"${imgDimsAttrs(post.cover_image)}${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" /></span>
      <span class="hero-body">
        <span class="kicker">Nổi bật · ${esc(post.category_name || "Bài mới")}</span>
        <span class="hero-title">${esc(post.title)}</span>
        <span class="hero-excerpt">${esc(post.excerpt)}</span>
        ${metaHTML(post, { withAuthor: true })}
        <span class="readmore">Đọc bài <span aria-hidden="true">→</span></span>
      </span>
    </a>
  </div>`;
}

export function heroSideHTML(posts) {
  if (!posts.length) return "";
  return posts
    .map(
      (post, index) => `<a class="hero-side-post" href="${postUrl(post)}">
        <span class="num">0${index + 1}</span>
        <img class="hero-side-thumb" draggable="false" src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}"${imgDimsAttrs(post.cover_image)} loading="lazy" decoding="async" />
        <span><span class="t">${esc(post.title)}</span><span class="d">${esc(formatDate(post.published_at))} · ${esc(post.category_name || "")}</span></span>
      </a>`,
    )
    .join("");
}

export function thumbStripHTML(posts) {
  if (!posts.length) return "";
  return posts
    .map(
      (post) => `<a class="thumb-card" href="${postUrl(post)}">
        <img draggable="false" src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}"${imgDimsAttrs(post.cover_image)} loading="lazy" decoding="async" />
        <span class="t">${esc(post.title)}</span>
      </a>`,
    )
    .join("");
}

export function popularHTML(posts) {
  return posts
    .map(
      (post, index) => `<a class="side-post" href="${postUrl(post)}">
        <span style="font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:800;color:var(--ink-faint);flex:none;width:28px">0${index + 1}</span>
        <img src="${esc(post.cover_image)}" alt="${esc(post.cover_alt || post.title)}"${imgDimsAttrs(post.cover_image)} loading="lazy" decoding="async" />
        <span><span class="t">${esc(post.title)}</span><span class="d">${esc(formatDate(post.published_at))} · ${esc(post.category_name || "")}</span></span>
      </a>`,
    )
    .join("");
}

export function categorySidebarHTML(categories, activeSlug = "") {
  const groups = new Map();
  for (const category of categories) {
    if (!groups.has(category.group_name)) groups.set(category.group_name, []);
    groups.get(category.group_name).push(category);
  }
  let html = "";
  for (const [groupKey, list] of groups) {
    const label = GROUP_META[groupKey]?.name || groupKey;
    html += `<li class="ghead">${esc(label)}</li>`;
    for (const category of list) {
      html += `<li><a href="${categoryUrl(category)}"${activeSlug === category.slug ? ' class="active"' : ""}><span>${esc(category.name)}</span><span class="n">${category.post_count ?? 0}</span></a></li>`;
    }
  }
  return html;
}

export function checklistHTML() {
  return `<div class="check-card" id="checkWidget">
    <h4>Checklist: Wifi nhanh trong 15 phút</h4>
    <p class="sub">Bấm vào từng mục khi làm xong. Làm hết 7 mục rồi đo lại tốc độ.</p>
    <div class="check-progress"><i id="checkBar"></i></div>
    <ul class="check-list" id="checkList">
      ${CHECKLIST.map(
        (text, index) =>
          `<li data-i="${index}" role="button" tabindex="0" aria-pressed="false"><span class="box"></span><span class="txt">${esc(text)}</span></li>`,
      ).join("")}
    </ul>
    <p class="check-done-msg" id="checkDone">Xong cả 7 mục. Giờ đo lại tốc độ ở chỗ hay ngồi — nếu vẫn chậm khi đứng cạnh router, lúc đó mới cần gọi nhà mạng.</p>
  </div>`;
}

export function sidebarHTML({ categories, popular, activeSlug = "", withChecklist = true }) {
  return `<aside class="side">
    <div class="widget">
      <h4>Về blog này</h4>
      <div class="wline"></div>
      <p>${esc(ABOUT_TEXT)}</p>
    </div>
    <div class="widget">
      <h4>Đọc nhiều</h4>
      <div class="wline"></div>
      <div>${popularHTML(popular)}</div>
    </div>
    <div class="widget">
      <h4>Chuyên mục</h4>
      <div class="wline"></div>
      <ul class="catlist">${categorySidebarHTML(categories, activeSlug)}</ul>
    </div>
    ${withChecklist ? checklistHTML() : ""}
  </aside>`;
}

export function paginationHTML({ page, totalPages, hrefFor }) {
  if (totalPages <= 1) return "";
  const links = [];
  links.push(
    page > 1
      ? `<a href="${hrefFor(page - 1)}" rel="prev" aria-label="Trang trước">‹</a>`
      : `<span class="disabled" aria-hidden="true">‹</span>`,
  );
  const windowStart = Math.max(1, page - 2);
  const windowEnd = Math.min(totalPages, page + 2);
  for (let n = windowStart; n <= windowEnd; n += 1) {
    links.push(
      n === page
        ? `<span class="active" aria-current="page">${n}</span>`
        : `<a href="${hrefFor(n)}">${n}</a>`,
    );
  }
  links.push(
    page < totalPages
      ? `<a href="${hrefFor(page + 1)}" rel="next" aria-label="Trang sau">›</a>`
      : `<span class="disabled" aria-hidden="true">›</span>`,
  );
  return `<nav class="pager" aria-label="Phân trang">${links.join("")}</nav>`;
}

export function emptyHTML(title = "Chưa tìm thấy bài nào", message = "Thử từ khóa khác, hoặc quay lại trang chủ để xem tất cả bài viết.") {
  return `<div class="empty"><strong>${esc(title)}</strong>${esc(message)}</div>`;
}

export function tagChipsHTML(tags) {
  if (!tags || !tags.length) return "";
  return `<div class="taglist" aria-label="Thẻ nội dung">${tags
    .map((tag) => `<a class="tag" href="${tagUrl(tag)}" rel="tag">#${esc(tag.name)}</a>`)
    .join("")}</div>`;
}

export function breadcrumbsHTML(items) {
  const parts = [];
  items.forEach((item, index) => {
    if (index > 0) parts.push('<span aria-hidden="true">›</span>');
    if (item.href) parts.push(`<a href="${item.href}">${esc(item.label)}</a>`);
    else parts.push(`<span aria-current="page">${esc(item.label)}</span>`);
  });
  return `<nav class="crumbs" aria-label="Breadcrumb">${parts.join("")}</nav>`;
}

export function tipsBandHTML() {
  return `<section class="tipsband" aria-label="Mẹo nhanh">
    <div class="wrap">
      <div class="sec-head" style="margin-top:0">
        <h2>Mẹo nhanh 1 phút</h2>
        <div class="line"></div>
      </div>
      <div class="tips-grid">
        ${TIPS.map(
          (tip, index) => `<div class="tip">
            <div class="no">0${index + 1}</div>
            <h3>${esc(tip.title)}</h3>
            <p>${esc(tip.text)}</p>
          </div>`,
        ).join("")}
      </div>
    </div>
  </section>`;
}

export function articleHeaderHTML(post) {
  return `${chip(post)}
    <h1>${esc(post.title)}</h1>
    ${post.lede ? `<p class="lede">${esc(post.lede)}</p>` : ""}
    ${metaHTML(post, { withAuthor: true })}`;
}
