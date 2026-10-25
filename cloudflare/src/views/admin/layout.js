import { esc } from "../helpers.js";
import { asset } from "../../lib/assets.js";
import { csrfInput, roleLabel } from "./ui.js";

const NAV = [
  { key: "dashboard", href: "/admin", label: "Tổng quan" },
  { key: "posts", href: "/admin/posts", label: "Bài viết", count: "posts" },
  { key: "new", href: "/admin/posts/new", label: "+ Tạo bài viết" },
  { key: "trash", href: "/admin/trash", label: "Thùng rác", count: "trash" },
  { key: "media", href: "/admin/media", label: "Thư viện ảnh" },
  { key: "categories", href: "/admin/categories", label: "Chuyên mục", roles: ["admin", "editor"] },
  { key: "tags", href: "/admin/tags", label: "Thẻ nội dung", roles: ["admin", "editor"] },
  { key: "users", href: "/admin/users", label: "Người dùng", roles: ["admin"] },
  { key: "api-clients", href: "/admin/api-clients", label: "API & tích hợp", roles: ["admin"] },
  { key: "audit", href: "/admin/audit", label: "Nhật ký hệ thống", roles: ["admin"] },
  { key: "security", href: "/admin/audit?scope=security", label: "Bảo mật & scraping", roles: ["admin"] },
  { key: "settings", href: "/admin/settings", label: "Cài đặt", roles: ["admin"] },
];

function navHTML(ctx, active) {
  return NAV.filter((item) => !item.roles || item.roles.includes(ctx.user.role))
    .map((item) => {
      const count = item.count ? ctx.adminCounts?.[item.count] : null;
      return `<a href="${item.href}"${active === item.key ? ' class="active" aria-current="page"' : ""}><span class="nav-dot" aria-hidden="true"></span>${esc(item.label)}${count ? `<span class="nav-count">${count}</span>` : ""}</a>`;
    })
    .join("");
}

export function renderAdmin(ctx, { title, subtitle = "", active = "dashboard", content, actions = "", wide = false }) {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="#143d29" />
    <title>${esc(title)} — Quản trị ${esc(ctx.settings.site_name)}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/QdVPSTAyLFyeg_IDWvOJmVES_Hw3BXo.woff2" crossorigin />
    <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/nuFiD-vYSZviVYUb_rj3ij__anPXDTzYgA.woff2" crossorigin />
    <link rel="stylesheet" href="${asset("/assets/css/fonts.css")}" />
    <link rel="stylesheet" href="${asset("/assets/css/style.css")}" />
    <link rel="stylesheet" href="${asset("/assets/css/admin.css")}" />
    <script nonce="${ctx.nonce}">(function(){try{var s=localStorage.getItem("mh-theme");var t=s||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();</script>
    <script src="${asset("/assets/js/admin.js")}" defer nonce="${ctx.nonce}"></script>
  </head>
  <body class="admin-body">
    <a class="skip-link" href="#admin-main">Bỏ qua điều hướng quản trị</a>
    <div class="admin-shell">
      <aside class="admin-side">
        <a class="admin-brand" href="/admin"><b>Mẹo Hay <em>Mỗi Ngày</em></b><span>Bảng điều khiển</span></a>
        <nav class="admin-nav" aria-label="Quản trị">${navHTML(ctx, active)}</nav>
        <div class="admin-side-foot">
          <div class="who"><b>${esc(ctx.user.name)}</b>${esc(roleLabel(ctx.user.role))}</div>
          <button id="themeToggle" class="theme-toggle" type="button" aria-label="Đổi giao diện sáng tối" aria-pressed="false"><span class="toggle-track"><span class="toggle-icon moon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg></span><span class="toggle-icon sun"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span><span class="toggle-knob"></span></span></button>
          <a href="/" target="_blank" rel="noopener">Xem website</a>
          <form method="post" action="/admin/logout">${csrfInput(ctx.csrf)}<button type="submit">Đăng xuất</button></form>
        </div>
      </aside>
      <div class="admin-main">
        <header class="admin-top">
          <div>
            <h1>${esc(title)}</h1>
            ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ""}
          </div>
          ${actions ? `<div class="top-actions">${actions}</div>` : ""}
        </header>
        <main id="admin-main" class="admin-content${wide ? " wide" : ""}">
          ${ctx.flash ? `<div class="flash ${ctx.flash.type}" role="status">${esc(ctx.flash.message)}</div>` : ""}
          ${content}
        </main>
      </div>
    </div>
  </body>
</html>`;
}
