import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { adminDate, adminPager, formatMeta } from "./ui.js";

const ACTOR_LABELS = { user: "Người dùng", api: "API", system: "Hệ thống" };

export function renderAudit(ctx, { rows, total, page, totalPages, filters, scope }) {
  const tabs = `<div class="tabs">
    <a href="/admin/audit"${scope !== "security" ? ' class="active"' : ""}>Toàn bộ nhật ký</a>
    <a href="/admin/audit?scope=security"${scope === "security" ? ' class="active"' : ""}>Sự kiện bảo mật</a>
  </div>`;
  const filterForm = `<form class="filters" method="get" action="/admin/audit">
    ${scope === "security" ? '<input type="hidden" name="scope" value="security" />' : ""}
    <div class="field"><label for="action">Hành động bắt đầu bằng</label><input id="action" type="search" name="action" value="${esc(filters.action || "")}" placeholder="post. hoặc security." /></div>
    <div class="field"><label for="actor">Đối tượng</label><select id="actor" name="actor"><option value="">Tất cả</option>${Object.entries(ACTOR_LABELS).map(([value, label]) => `<option value="${value}"${filters.actor === value ? " selected" : ""}>${label}</option>`).join("")}</select></div>
    <button class="btn" type="submit">Lọc</button>
    <a class="btn btn-sm" href="/admin/audit${scope === "security" ? "?scope=security" : ""}">Xóa lọc</a>
  </form>`;

  const table = `<div class="table-wrap"><table class="admin">
    <thead><tr><th>Thời gian</th><th>Đối tượng</th><th>Hành động</th><th>Nội dung</th><th>IP</th></tr></thead>
    <tbody>${rows
      .map(
        (row) => `<tr>
          <td class="text-muted">${adminDate(row.created_at)}</td>
          <td>${esc(ACTOR_LABELS[row.actor_type] || row.actor_type)}${row.actor_name ? `<div><strong>${esc(row.actor_name)}</strong></div>` : ""}${row.actor_id ? `<div class="mono">${esc(String(row.actor_id).slice(0, 12))}</div>` : ""}</td>
          <td class="mono">${esc(row.action)}${row.entity_type ? `<div class="text-muted">${esc(row.entity_type)} ${esc(String(row.entity_id || "").slice(0, 8))}</div>` : ""}</td>
          <td>${formatMeta(row.meta)}</td>
          <td class="text-muted mono">${esc(row.ip || "—")}</td>
        </tr>`,
      )
      .join("")}</tbody>
  </table></div>`;

  return renderAdmin(ctx, {
    title: scope === "security" ? "Bảo mật & scraping" : "Nhật ký hệ thống",
    subtitle:
      scope === "security"
        ? "Các lần chặn bot, giới hạn truy cập và hotlink. Dữ liệu giúp chỉnh ngưỡng phòng vệ."
        : "Lịch sử thao tác quan trọng của người dùng, API và tác vụ hệ thống.",
    active: scope === "security" ? "security" : "audit",
    actions: `<a class="btn" href="/admin/api-clients">API client</a>`,
    content: `${tabs}${filterForm}
      ${rows.length ? table : `<div class="empty-state"><b>Không có sự kiện phù hợp</b>Thử đổi bộ lọc.</div>`}
      ${adminPager({ page, totalPages, base: "/admin/audit", query: { ...filters, scope: scope === "security" ? "security" : "" } })}
      <p class="text-muted" style="margin-top:14px">Tổng: ${total} bản ghi.</p>`,
    wide: true,
  });
}
