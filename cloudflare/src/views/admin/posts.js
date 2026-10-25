import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { statusBadge, adminDate, adminPager, csrfInput } from "./ui.js";
import { STATUS_LABELS, canEditPost } from "../../lib/permissions.js";

function trashTable(ctx, result) {
  return `<form method="post" action="/admin/posts/bulk/apply" id="bulkForm">
    ${csrfInput(ctx.csrf)}
    <input type="hidden" name="return_to" value="/admin/trash" />
    <div class="filters" style="margin-bottom:14px">
      <label class="check"><input type="checkbox" id="selectAll" /> Chọn tất cả</label>
      <select name="bulk_action" aria-label="Thao tác hàng loạt">
        <option value="restore">Khôi phục</option>
        ${ctx.user.role === "admin" ? '<option value="purge">Xóa vĩnh viễn</option>' : ""}
      </select>
      <button class="btn btn-sm" type="submit">Áp dụng</button>
    </div>
  </form>
  <div class="table-wrap"><table class="admin">
      <thead><tr><th></th><th>Bài viết</th><th>Xóa lúc</th><th></th></tr></thead>
      <tbody>${result.items
        .map(
          (post) => `<tr>
            <td><input type="checkbox" name="ids" value="${post.id}" form="bulkForm" aria-label="Chọn ${esc(post.title)}" /><input type="hidden" name="version-${post.id}" value="${post.version}" form="bulkForm" /></td>
            <td><div class="title-cell">${post.cover_image ? `<img src="${esc(post.cover_image)}" alt="" />` : ""}<div><a href="/admin/posts/${post.id}/preview">${esc(post.title)}</a><span class="text-muted">/bai-viet/${esc(post.slug)}</span></div></div></td>
            <td class="text-muted">${adminDate(post.deleted_at)}</td>
            <td><div class="row-actions">
              <a class="btn btn-sm" href="/admin/posts/${post.id}/preview">Xem trước</a>
              <form method="post" action="/admin/posts/${post.id}/restore" data-confirm="Khôi phục bài viết này?">${csrfInput(ctx.csrf)}<input type="hidden" name="version" value="${post.version}" /><button class="btn btn-sm" type="submit">Khôi phục</button></form>
              ${ctx.user.role === "admin" ? `<form method="post" action="/admin/posts/${post.id}/purge" data-confirm="Xóa vĩnh viễn bài viết này? Không thể hoàn tác.">${csrfInput(ctx.csrf)}<input type="hidden" name="version" value="${post.version}" /><button class="btn btn-sm btn-danger" type="submit">Xóa</button></form>` : ""}
            </div></td>
          </tr>`,
        )
        .join("")}</tbody>
    </table></div>`;
}

function postsTable(ctx, result, canPublish) {
  return `<form method="post" action="/admin/posts/bulk/apply" id="bulkForm">
    ${csrfInput(ctx.csrf)}
    <input type="hidden" name="return_to" value="${esc(ctx.returnTo)}" />
    <div class="filters" style="margin-bottom:14px">
      <label class="check"><input type="checkbox" id="selectAll" /> Chọn tất cả</label>
      <select name="bulk_action" aria-label="Thao tác hàng loạt">
        <option value="draft">Chuyển về nháp</option>
        ${canPublish ? '<option value="publish">Xuất bản</option><option value="archive">Lưu trữ</option>' : ""}
        <option value="trash">Chuyển vào thùng rác</option>
      </select>
      <button class="btn btn-sm" type="submit">Áp dụng</button>
    </div>
  </form>
  <div class="table-wrap"><table class="admin">
      <thead><tr><th></th><th>Bài viết</th><th>Trạng thái</th><th>Chuyên mục</th><th>Tác giả</th><th>Cập nhật</th><th></th></tr></thead>
      <tbody>${result.items
        .map((post) => {
          const editable = canEditPost(ctx.user, post);
          return `<tr>
            <td><input type="checkbox" name="ids" value="${post.id}" form="bulkForm" aria-label="Chọn ${esc(post.title)}" /><input type="hidden" name="version-${post.id}" value="${post.version}" form="bulkForm" /></td>
            <td><div class="title-cell">${post.cover_image ? `<img src="${esc(post.cover_image)}" alt="" />` : ""}<div><a href="/admin/posts/${post.id}/${editable ? "edit" : "preview"}">${esc(post.title)}</a><span class="text-muted">/bai-viet/${esc(post.slug)}</span></div></div></td>
            <td>${statusBadge(post.status)}</td>
            <td>${esc(post.category_name || "—")}</td>
            <td>${esc(post.author_name || "—")}</td>
            <td class="text-muted">${adminDate(post.updated_at)}</td>
            <td><div class="row-actions">
              ${editable ? `<a class="btn btn-sm" href="/admin/posts/${post.id}/edit">Sửa</a>` : ""}
              <a class="btn btn-sm" href="/admin/posts/${post.id}/preview">Xem trước</a>
              ${post.status === "published" ? `<a class="btn btn-sm" href="/bai-viet/${encodeURIComponent(post.slug)}" target="_blank" rel="noopener">Xem</a>` : ""}
              ${editable ? `<form method="post" action="/admin/posts/${post.id}/delete" data-confirm="Chuyển bài viết vào thùng rác?">${csrfInput(ctx.csrf)}<input type="hidden" name="version" value="${post.version}" /><button class="btn btn-sm btn-danger" type="submit">Xóa</button></form>` : ""}
            </div></td>
          </tr>`;
        })
        .join("")}</tbody>
    </table></div>`;
}

export function renderPosts(ctx, { result, filters, categories, users, canPublish, trash = false }) {
  const actions = trash
    ? `<a class="btn" href="/admin/posts">← Danh sách bài viết</a>`
    : `<a class="btn btn-primary" href="/admin/posts/new">+ Tạo bài viết</a>`;
  ctx.returnTo = trash
    ? "/admin/trash"
    : `/admin/posts${new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString() ? `?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()}` : ""}`;

  const filterForm = `<form class="filters" method="get" action="${trash ? "/admin/trash" : "/admin/posts"}">
    <div class="field"><label for="f-q">Tìm kiếm</label><input id="f-q" type="search" name="q" value="${esc(filters.q || "")}" placeholder="Tiêu đề hoặc slug" /></div>
    ${trash ? "" : `<div class="field"><label for="f-status">Trạng thái</label><select id="f-status" name="status"><option value="">Tất cả</option>${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}"${filters.status === value ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></div>`}
    <div class="field"><label for="f-cat">Chuyên mục</label><select id="f-cat" name="category"><option value="">Tất cả</option>${categories.map((category) => `<option value="${category.id}"${filters.category === category.id ? " selected" : ""}>${esc(category.name)}</option>`).join("")}</select></div>
    ${ctx.user.role !== "author" ? `<div class="field"><label for="f-author">Tác giả</label><select id="f-author" name="author"><option value="">Tất cả</option>${users.map((user) => `<option value="${user.id}"${filters.author === user.id ? " selected" : ""}>${esc(user.name)}</option>`).join("")}</select></div>` : ""}
    <button class="btn" type="submit">Lọc</button>
    <a class="btn btn-sm" href="${trash ? "/admin/trash" : "/admin/posts"}">Xóa lọc</a>
  </form>`;

  const content = `${filterForm}
    ${result.items.length ? (trash ? trashTable(ctx, result) : postsTable(ctx, result, canPublish)) : `<div class="empty-state"><b>${trash ? "Thùng rác trống" : "Chưa có bài viết"}</b>${trash ? "Bài viết đã xóa sẽ nằm ở đây." : "Bấm “Tạo bài viết” để bắt đầu."}</div>`}
    ${adminPager({ page: result.page, totalPages: result.totalPages, base: trash ? "/admin/trash" : "/admin/posts", query: filters })}
    <p class="text-muted" style="margin-top:14px">Tổng: ${result.total} bài viết.</p>`;

  return renderAdmin(ctx, {
    title: trash ? "Thùng rác" : "Bài viết",
    subtitle: trash
      ? "Bài viết đã xóa có thể khôi phục. Chỉ quản trị viên mới xóa vĩnh viễn."
      : "Quản lý nội dung, trạng thái duyệt và lịch xuất bản.",
    active: trash ? "trash" : "posts",
    actions,
    content,
    wide: true,
  });
}
