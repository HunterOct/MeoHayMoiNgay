import { esc } from "./helpers.js";
import { renderPage } from "./layout.js";
import { catRowHTML, sidebarHTML, paginationHTML, emptyHTML, breadcrumbsHTML } from "./components.js";
import { checklistFor } from "./constants.js";

export function renderList(ctx, opts) {
  const {
    title,
    heading,
    description = "",
    posts,
    page,
    totalPages,
    hrefFor,
    canonicalPath,
    activeCategorySlug = "",
    activeGroup = "",
    activeAll = false,
    noindex = false,
    searchQuery = "",
    crumbs = [],
    emptyTitle,
    emptyMessage,
  } = opts;

  const listHtml = posts.length
    ? `<div class="cat-list">${posts.map(catRowHTML).join("")}</div>${paginationHTML({ page, totalPages, hrefFor })}`
    : emptyHTML(emptyTitle, emptyMessage);

  const content = `<div class="wrap">
    ${crumbs.length ? breadcrumbsHTML(crumbs) : ""}
    <div class="sec-head">
      <h2>${esc(heading || title)}</h2>
      <div class="line"></div>
    </div>
    ${description ? `<p class="archive-desc">${esc(description)}</p>` : ""}
    <div class="layout">
      <div>${listHtml}</div>
      ${sidebarHTML({
        categories: ctx.chrome.categories,
        popular: opts.popular || [],
        activeSlug: activeCategorySlug,
        withChecklist: true,
        checklist: checklistFor({ group: activeGroup, categorySlug: activeCategorySlug }),
      })}
    </div>
  </div>`;

  return renderPage(ctx, {
    title,
    description: description || ctx.settings.site_description,
    canonicalPath,
    ogImage: posts[0]?.cover_image,
    isHome: false,
    activeCategorySlug,
    activeGroup,
    activeAll,
    noindex,
    searchQuery,
    jsonLd: opts.jsonLd || [],
    content,
  });
}
