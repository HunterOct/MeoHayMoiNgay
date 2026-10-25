import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { statusBadge, adminDate, formatMeta } from "./ui.js";
import { STATUS_LABELS } from "../../lib/permissions.js";

function statsHTML(ctx, data) {
  const counts = ctx.adminCounts;
  const items = [
    { label: "Đã xuất bản", value: counts.published, href: "/admin/posts?status=published", cls: "good" },
    { label: "Bản nháp", value: counts.draft, href: "/admin/posts?status=draft" },
    { label: "Chờ duyệt", value: counts.review, href: "/admin/posts?status=review", cls: counts.review ? "warn" : "" },
    { label: "Đã lên lịch", value: counts.scheduled, href: "/admin/posts?status=scheduled" },
    { label: "Lưu trữ", value: counts.archived, href: "/admin/posts?status=archived" },
    { label: "Thùng rác", value: counts.trash, href: "/admin/trash", cls: counts.trash ? "warn" : "" },
  ];
  if (ctx.user.role === "admin") {
    items.push({ label: "Ảnh trong thư viện", value: data.mediaCount, href: "/admin/media" });
    items.push({ label: "Người dùng", value: data.userCount, href: "/admin/users" });
    items.push({ label: "API client", value: data.clientCount, href: "/admin/api-clients" });
  }
  return `<div class="stat-grid">${items
    .map(
      (item) =>
        `<a class="stat ${item.cls || ""}" href="${item.href}"><span class="n">${item.value}</span><span class="l">${esc(item.label)}</span></a>`,
    )
    .join("")}</div>`;
}

function recentPostsHTML(posts) {
  if (!posts.length) {
    return `<div class="empty-state"><b>Chưa có bài viết</b>Bấm “Tạo bài viết” để bắt đầu.</div>`;
  }
  return `<div class="table-wrap"><table class="admin">
    <thead><tr><th>Bài viết</th><th>Trạng thái</th><th>Cập nhật</th><th></th></tr></thead>
    <tbody>${posts
      .map(
        (post) => `<tr>
          <td><div class="title-cell">${post.cover_image ? `<img src="${esc(post.cover_image)}" alt="" />` : ""}<div><a href="/admin/posts/${post.id}/edit">${esc(post.title)}</a><span class="text-muted">${esc(post.category_name || "Chưa phân loại")}</span></div></div></td>
          <td>${statusBadge(post.status, Boolean(post.deleted_at))}</td>
          <td class="text-muted">${adminDate(post.updated_at)}</td>
          <td><a class="btn btn-sm" href="/admin/posts/${post.id}/edit">Sửa</a></td>
        </tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function upcomingHTML(posts) {
  if (!posts.length) return `<p class="text-muted">Không có bài nào chờ xuất bản.</p>`;
  return `<div class="table-wrap"><table class="admin">
    <thead><tr><th>Bài viết</th><th>Thời điểm</th><th></th></tr></thead>
    <tbody>${posts
      .map(
        (post) => `<tr>
          <td><a href="/admin/posts/${post.id}/edit">${esc(post.title)}</a></td>
          <td class="text-muted">${adminDate(post.scheduled_at)}</td>
          <td><span class="badge scheduled">${esc(STATUS_LABELS.scheduled)}</span></td>
        </tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function auditHTML(rows) {
  if (!rows.length) return `<p class="text-muted">Chưa có hoạt động nào.</p>`;
  return `<div class="table-wrap"><table class="admin">
    <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Chi tiết</th></tr></thead>
    <tbody>${rows
      .map(
        (row) => `<tr>
          <td class="text-muted">${adminDate(row.created_at)}</td>
          <td>${esc(row.actor_type)}${row.actor_name ? ` · <strong>${esc(row.actor_name)}</strong>` : ""}${row.actor_id ? ` <span class="mono">${esc(String(row.actor_id).slice(0, 8))}</span>` : ""}</td>
          <td class="mono">${esc(row.action)}</td>
          <td>${formatMeta(row.meta)}</td>
        </tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function securityHTML(events, count24h) {
  return `<div class="card">
    <div class="card-head"><h2>Bảo mật 24 giờ qua</h2><span class="badge ${count24h ? "review" : "published"}">${count24h} sự kiện</span></div>
    <p class="card-sub">Sự kiện chặn bot, giới hạn truy cập và hotlink. Chỉ hiển thị cho quản trị viên.</p>
    ${events.length ? `<div class="table-wrap"><table class="admin"><thead><tr><th>Thời gian</th><th>Sự kiện</th><th>Chi tiết</th></tr></thead><tbody>${events
      .map(
        (event) => `<tr><td class="text-muted">${adminDate(event.created_at)}</td><td class="mono">${esc(event.action)}</td><td>${formatMeta(event.meta)}</td></tr>`,
      )
      .join("")}</tbody></table></div>` : `<p class="text-muted">Không phát hiện hoạt động bất thường.</p>`}
  </div>`;
}

export function renderDashboard(ctx, data) {
  const actions = `<a class="btn btn-primary" href="/admin/posts/new">+ Tạo bài viết</a>`;
  const isAdmin = ctx.user.role === "admin";
  const content = `
    ${statsHTML(ctx, data)}
    <div class="card">
      <div class="card-head"><h2>Bài viết gần đây</h2><a class="btn btn-sm" href="/admin/posts">Xem tất cả</a></div>
      ${recentPostsHTML(data.recent)}
    </div>
    <div class="card">
      <div class="card-head"><h2>Bài đã lên lịch</h2></div>
      ${upcomingHTML(data.upcoming)}
    </div>
    ${isAdmin ? securityHTML(data.securityEvents, data.securityCount24h) : ""}
    ${isAdmin ? `<div class="card"><div class="card-head"><h2>Hoạt động gần đây</h2><a class="btn btn-sm" href="/admin/audit">Nhật ký đầy đủ</a></div>${auditHTML(data.audit)}</div>` : ""}
  `;
  return renderAdmin(ctx, {
    title: `Xin chào, ${ctx.user.name}`,
    subtitle:
      ctx.user.role === "author"
        ? "Bạn có thể soạn bài và gửi duyệt. Biên tập viên sẽ xuất bản."
        : "Tổng quan nội dung, lịch xuất bản và hoạt động hệ thống.",
    active: "dashboard",
    actions,
    content,
  });
}
