import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";

export function renderAdminError(ctx, { status, title, message }) {
  if (ctx.user && ctx.csrf) {
    return renderAdmin(ctx, {
      title: `Lỗi ${status}`,
      subtitle: title,
      active: "",
      content: `<div class="card"><h2>${esc(title)}</h2><p class="text-muted">${esc(message)}</p><p style="margin-top:16px"><a class="btn" href="/admin">← Về tổng quan</a></p></div>`,
    });
  }
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Lỗi ${status} — Quản trị</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/assets/css/style.css" />
    <link rel="stylesheet" href="/assets/css/admin.css" />
  </head>
  <body class="admin-body">
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">Mẹo Hay <em>Mỗi Ngày</em></div>
        <div class="login-sub">Lỗi ${status}</div>
        <div class="flash err">${esc(message)}</div>
        <p class="login-foot"><a href="/admin/login">Đăng nhập</a> · <a href="/">Trang chủ</a></p>
      </div>
    </div>
  </body>
</html>`;
}
