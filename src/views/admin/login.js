import { esc } from "../helpers.js";
import { asset } from "../../lib/assets.js";
import { errorMessage } from "./ui.js";

export function renderLogin(ctx, { csrf, error = "", next = "" }) {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Đăng nhập quản trị — ${esc(ctx.settings.site_name)}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="${asset("/assets/css/style.css")}" />
    <link rel="stylesheet" href="${asset("/assets/css/admin.css")}" />
    <script nonce="${ctx.nonce}">(function(){try{var s=localStorage.getItem("mh-theme");var t=s||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();</script>
  </head>
  <body class="admin-body">
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">Mẹo Hay <em>Mỗi Ngày</em></div>
        <div class="login-sub">Đăng nhập quản trị</div>
        ${error ? `<div class="flash err" role="alert">${esc(errorMessage(error))}</div>` : ""}
        <form method="post" action="/admin/login" autocomplete="on">
          <input type="hidden" name="_csrf" value="${esc(csrf)}" />
          <input type="hidden" name="next" value="${esc(next)}" />
          <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" required autofocus autocomplete="username" />
          </div>
          <div class="field">
            <label for="password">Mật khẩu</label>
            <input id="password" name="password" type="password" required autocomplete="current-password" />
          </div>
          <button class="btn btn-primary" type="submit">Đăng nhập</button>
        </form>
        <p class="login-foot"><a href="/">← Về trang chủ</a></p>
      </div>
    </div>
  </body>
</html>`;
}
