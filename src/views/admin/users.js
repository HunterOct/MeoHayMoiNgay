import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { csrfInput, adminDate, roleLabel } from "./ui.js";

const ROLES = [
  { value: "admin", label: "Quản trị viên — toàn quyền" },
  { value: "editor", label: "Biên tập viên — duyệt và xuất bản bài" },
  { value: "author", label: "Tác giả — soạn bài, gửi duyệt" },
];

export function renderUsers(ctx, users) {
  const create = `<div class="card">
    <h2>Thêm tài khoản</h2>
    <p class="card-sub">Mật khẩu tối thiểu 10 ký tự, có cả chữ và số. Không dùng mật khẩu chung.</p>
    <form method="post" action="/admin/users" class="form-grid">
      ${csrfInput(ctx.csrf)}
      <div class="field"><label for="new-name">Họ tên</label><input id="new-name" name="name" type="text" required maxlength="120" /></div>
      <div class="field"><label for="new-email">Email</label><input id="new-email" name="email" type="email" required maxlength="200" /></div>
      <div class="field"><label for="new-role">Vai trò</label><select id="new-role" name="role">${ROLES.map((r) => `<option value="${r.value}"${r.value === "author" ? " selected" : ""}>${esc(r.label)}</option>`).join("")}</select></div>
      <div class="field"><label for="new-password">Mật khẩu</label><input id="new-password" name="password" type="password" required minlength="10" autocomplete="new-password" /></div>
      <div class="full"><button class="btn btn-primary" type="submit">Tạo tài khoản</button></div>
    </form>
  </div>`;

  const list = `<div class="card">
    <h2>Tài khoản (${users.length})</h2>
    <p class="card-sub">Có thể khóa đăng nhập hoặc đổi vai trò. Không thể tự khóa hoặc hạ quyền chính mình.</p>
    ${users
      .map(
        (user) => `<div class="card" style="margin-bottom:14px;padding:18px">
          <form method="post" action="/admin/users/${user.id}" class="form-grid">
            ${csrfInput(ctx.csrf)}
            <div class="field"><label>Họ tên</label><input name="name" type="text" required maxlength="120" value="${esc(user.name)}" /></div>
            <div class="field"><label>Email</label><input name="email" type="email" required maxlength="200" value="${esc(user.email)}" /></div>
            <div class="field"><label>Vai trò</label><select name="role">${ROLES.map((r) => `<option value="${r.value}"${user.role === r.value ? " selected" : ""}>${esc(r.label)}</option>`).join("")}</select></div>
            <div class="field"><label>Mật khẩu mới (tuỳ chọn)</label><input name="password" type="password" minlength="10" autocomplete="new-password" placeholder="Để trống nếu không đổi" /></div>
            <div class="full" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
              <label class="check"><input type="checkbox" name="is_active" value="1"${user.is_active ? " checked" : ""} /> Được phép đăng nhập</label>
              <span class="text-muted">${user.post_count} bài · Đăng nhập cuối: ${adminDate(user.last_login_at)} · ${esc(roleLabel(user.role))}</span>
              <button class="btn" type="submit" style="margin-left:auto">Cập nhật</button>
            </div>
          </form>
        </div>`,
      )
      .join("")}
  </div>`;

  return renderAdmin(ctx, {
    title: "Người dùng",
    subtitle: "Phân quyền được kiểm tra ở backend cho mọi thao tác, không chỉ ẩn nút trên giao diện.",
    active: "users",
    actions: `<a class="btn" href="/admin/posts">← Bài viết</a>`,
    content: `${create}${list}`,
    wide: true,
  });
}
