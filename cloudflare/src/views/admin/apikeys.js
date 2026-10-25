import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { csrfInput, adminDate } from "./ui.js";

export const SCOPE_LABELS = {
  "posts:read": "Đọc bài viết",
  "posts:write": "Tạo và cập nhật bài",
  "posts:publish": "Xuất bản / lên lịch",
  "media:write": "Tải ảnh lên",
  "taxonomy:read": "Đọc chuyên mục và thẻ",
};

function scopeChecks(selected = []) {
  return `<div class="scope-list">${Object.entries(SCOPE_LABELS)
    .map(
      ([scope, label]) =>
        `<label><input type="checkbox" name="scopes" value="${scope}"${selected.includes(scope) ? " checked" : ""} /> ${esc(label)} <span class="mono">${scope}</span></label>`,
    )
    .join("")}</div>`;
}

export function renderApiClients(ctx, { clients, newKey = null, apiBase }) {
  const reveal = newKey
    ? `<div class="apikey-reveal">
        <strong>API key mới cho “${esc(newKey.name)}”</strong>
        <p style="margin:6px 0 0;font-size:13px">Sao chép ngay — key chỉ hiển thị một lần. Server lưu hash, không lưu key gốc.</p>
        <code id="newApiKey">${esc(newKey.key)}</code>
        <button class="btn btn-sm" type="button" data-copy="#newApiKey">Sao chép key</button>
        <p class="warn">Không đưa key vào frontend, repo hay chat công khai. Thu hồi ngay nếu lộ.</p>
      </div>`
    : "";

  const create = `<div class="card">
    <h2>Tạo API client</h2>
    <p class="card-sub">Dành cho hệ thống AI bên ngoài. Key có thể thu hồi hoặc xoay vòng bất kỳ lúc nào.</p>
    <form method="post" action="/admin/api-clients" class="form-grid">
      ${csrfInput(ctx.csrf)}
      <div class="field full"><label for="name">Tên client</label><input id="name" name="name" type="text" required maxlength="120" placeholder="Ví dụ: AI Publisher production" /></div>
      <div class="field full"><label>Quyền</label>${scopeChecks(["posts:read", "posts:write"])}</div>
      <div class="field"><label for="mode">Chế độ xuất bản</label><select id="mode" name="publish_mode"><option value="review">Chờ duyệt trước khi đăng</option><option value="auto">Tự động xuất bản khi được cấp quyền</option></select></div>
      <div class="field"><label for="rate">Giới hạn request / phút</label><input id="rate" name="rate_limit_per_min" type="number" min="10" max="600" value="60" /></div>
      <div class="full"><button class="btn btn-primary" type="submit">Tạo client &amp; lấy key</button></div>
    </form>
  </div>`;

  const rows = clients.length
    ? clients
        .map(
          (client) => `<div class="card" style="margin-bottom:14px;padding:18px">
            <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px">
              <div style="flex:1;min-width:220px">
                <strong>${esc(client.name)}</strong>
                <div class="text-muted mono">${esc(client.key_id)} · Tạo ${adminDate(client.created_at)} · Dùng cuối ${adminDate(client.last_used_at)}</div>
                <div class="text-muted">${client.post_count} bài · ${client.publish_mode === "auto" ? "Tự động xuất bản" : "Chờ duyệt"} · ${client.rate_limit_per_min} req/phút</div>
              </div>
              <span class="badge ${client.is_active && !client.revoked_at ? "published" : "trash"}">${client.is_active && !client.revoked_at ? "Đang hoạt động" : "Đã thu hồi"}</span>
            </div>
            <form method="post" action="/admin/api-clients/${client.id}" class="form-grid">
              ${csrfInput(ctx.csrf)}
              <div class="field"><label>Tên</label><input name="name" type="text" value="${esc(client.name)}" required maxlength="120" /></div>
              <div class="field"><label>Chế độ</label><select name="publish_mode"><option value="review"${client.publish_mode === "review" ? " selected" : ""}>Chờ duyệt</option><option value="auto"${client.publish_mode === "auto" ? " selected" : ""}>Tự động xuất bản</option></select></div>
              <div class="field"><label>Giới hạn / phút</label><input name="rate_limit_per_min" type="number" min="10" max="600" value="${client.rate_limit_per_min}" /></div>
              <div class="field full"><label>Quyền</label>${scopeChecks(client.scopes)}</div>
              <div class="full" style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn" type="submit">Cập nhật</button>
                <button class="btn" type="submit" formaction="/admin/api-clients/${client.id}/rotate" data-confirm="Xoay vòng key? Key cũ sẽ ngừng hoạt động ngay.">Xoay vòng key</button>
                <button class="btn btn-danger" type="submit" formaction="/admin/api-clients/${client.id}/revoke" data-confirm="Thu hồi client này? Mọi request với key cũ sẽ bị từ chối."${client.revoked_at ? " disabled" : ""}>Thu hồi</button>
              </div>
            </form>
          </div>`,
        )
        .join("")
    : `<div class="empty-state"><b>Chưa có API client</b>Tạo client đầu tiên để hệ thống AI có thể gửi bài.</div>`;

  return renderAdmin(ctx, {
    title: "API & tích hợp",
    subtitle: "Quản lý key, quyền và chế độ duyệt cho hệ thống xuất bản tự động.",
    active: "api-clients",
    actions: `<a class="btn" href="/admin/audit">Nhật ký</a>`,
    content: `${reveal}<div class="card"><h2>Thông tin tích hợp</h2><p class="card-sub">Base URL: <span class="mono">${esc(apiBase)}</span> · Xác thực: <span class="mono">Authorization: Bearer &lt;key&gt;</span> · Tài liệu: <span class="mono">docs/API.md</span> và <span class="mono">openapi.yaml</span></p><p class="text-muted">Chế độ “Chờ duyệt”: mọi yêu cầu xuất bản từ client bị hạ về trạng thái chờ duyệt. Chế độ “Tự động”: chỉ xuất bản khi client có scope <span class="mono">posts:publish</span>.</p></div>${create}<div class="card"><h2>Danh sách client (${clients.length})</h2></div>${rows}`,
    wide: true,
  });
}
