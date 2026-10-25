import { esc, postUrl } from "./helpers.js";
import { renderPage } from "./layout.js";
import {
  articleHeaderHTML,
  breadcrumbsHTML,
  tagChipsHTML,
  cardHTML,
} from "./components.js";
import { imagePicture } from "../lib/image-meta.js";
import { AUTHOR_BIO } from "./constants.js";

export function renderArticle(ctx, { post, related, prev, next, jsonLd, noindex = false, preview = false }) {
  const crumbs = [
    { label: "Trang chủ", href: "/" },
    ...(post.category_slug
      ? [{ label: post.category_name, href: `/chuyen-muc/${encodeURIComponent(post.category_slug)}` }]
      : []),
    { label: post.title },
  ];

  const prevNext = `<div class="prevnext">
    ${
      prev
        ? `<a class="pn prev" href="${postUrl(prev)}"><span class="dir">← Bài trước</span><span class="ttl">${esc(prev.title)}</span></a>`
        : "<span></span>"
    }
    ${
      next
        ? `<a class="pn next" href="${postUrl(next)}"><span class="dir">Bài sau →</span><span class="ttl">${esc(next.title)}</span></a>`
        : "<span></span>"
    }
  </div>`;

  const content = `<div class="wrap">
    ${
      preview
        ? `<div class="preview-bar" role="status"><strong>Đang xem trước</strong> · Trạng thái: ${esc(post.status)} · <a href="/admin/posts/${esc(post.id)}/edit">Quay lại trình soạn thảo</a>${post.deleted_at ? " · Bài đang nằm trong thùng rác" : ""}</div>`
        : ""
    }
    ${breadcrumbsHTML(crumbs)}
    <article class="article">
      ${articleHeaderHTML(post)}
      ${
        post.cover_image
          ? `<figure class="heroimg">${imagePicture(post.cover_image, { alt: post.cover_alt || post.title, eager: true, sizes: "(max-width: 900px) 100vw, 760px" })}</figure>`
          : ""
      }
      ${post.cover_caption ? `<p class="caption">${esc(post.cover_caption)}</p>` : ""}
      <div class="prose">${post.content_html}</div>
      ${tagChipsHTML(post.tags)}
      <div class="endmark" aria-hidden="true">❦</div>
      <div class="authorbox">
        <span class="avatar" aria-hidden="true">${esc((post.author_name || "B").charAt(0))}</span>
        <div>
          <span class="an">${esc(post.author_name || "Bé Dâu")}</span>
          <p>${esc(post.author_bio || AUTHOR_BIO)}</p>
        </div>
      </div>
      ${prevNext}
    </article>
    <section class="article" aria-label="Bài liên quan">
      <div class="sec-head" style="margin-top:36px">
        <h2>Bài liên quan</h2>
        <div class="line"></div>
      </div>
      <div class="post-grid">
        ${related.map(cardHTML).join("")}
      </div>
      <div class="backrow"><a class="btn-ghost" href="/">← Quay lại trang chủ</a></div>
    </section>
  </div>`;

  return renderPage(ctx, {
    title: `${noindex ? "[Xem trước] " : ""}${post.seo_title || post.title}`,
    description: post.seo_description || post.excerpt || ctx.settings.site_description,
    canonicalPath: preview ? null : post.canonical_url || `/bai-viet/${encodeURIComponent(post.slug)}`,
    ogType: "article",
    ogImage: post.og_image || post.cover_image,
    preloadImage: post.cover_image || null,
    activeCategorySlug: post.category_slug || "",
    activeGroup: post.category_group || "",
    noindex,
    jsonLd,
    extraHead: `<meta property="article:published_time" content="${esc(post.published_at || post.created_at)}" />${
      post.updated_at ? `<meta property="article:modified_time" content="${esc(post.updated_at)}" />` : ""
    }<meta property="article:section" content="${esc(post.category_name || "")}" />`,
    content,
  });
}
