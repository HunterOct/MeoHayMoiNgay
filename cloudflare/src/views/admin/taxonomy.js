import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { csrfInput } from "./ui.js";

const GROUPS = [
  { value: "life", label: "Đời sống" },
  { value: "tech", label: "Công nghệ" },
];

export function renderCategories(ctx, { categories }) {
  const create = `<div class="card">
    <h2>Thêm chuyên mục</h2>
    <form method="post" action="/admin/categories" class="form-grid">
      ${csrfInput(ctx.csrf)}
      <div class="field"><label for="name">Tên</label><input id="name" name="name" type="text" required maxlength="80" /></div>
      <div class="field"><label for="slug">Slug</label><input id="slug" name="slug" type="text" maxlength="90" placeholder="Tự tạo nếu trống" /></div>
      <div class="field"><label for="group">Nhóm</label><select id="group" name="group">${GROUPS.map((g) => `<option value="${g.value}">${g.label}</option>`).join("")}</select></div>
      <div class="field"><label for="sort">Thứ tự</label><input id="sort" name="sort_order" type="number" value="0" /></div>
      <div class="field full"><label for="description">Mô tả</label><textarea id="description" name="description" rows="2" maxlength="300"></textarea></div>
      <div class="full"><button class="btn btn-primary" type="submit">Tạo chuyên mục</button></div>
    </form>
  </div>`;

  const rows = categories
    .map(
      (category) => `<tr>
        <td><input form="cat-${category.id}" name="name" type="text" value="${esc(category.name)}" required style="width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--ink)" /></td>
        <td><input form="cat-${category.id}" name="slug" type="text" value="${esc(category.slug)}" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--ink)" /></td>
        <td><select form="cat-${category.id}" name="group" style="border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--ink)">${GROUPS.map((g) => `<option value="${g.value}"${category.group_name === g.value ? " selected" : ""}>${g.label}</option>`).join("")}</select></td>
        <td><input form="cat-${category.id}" name="sort_order" type="number" value="${category.sort_order}" style="width:70px;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--ink)" /></td>
        <td><a href="/chuyen-muc/${esc(category.slug)}" target="_blank" rel="noopener">${category.post_count}</a></td>
        <td><div class="row-actions">
          <form id="cat-${category.id}" method="post" action="/admin/categories/${category.id}">${csrfInput(ctx.csrf)}<button class="btn btn-sm" type="submit">Cập nhật</button></form>
          <form method="post" action="/admin/categories/${category.id}/delete" data-confirm="Xóa chuyên mục ${esc(category.name)}?${category.post_count ? " Bài viết sẽ được chuyển sang chuyên mục đã chọn." : ""}">${csrfInput(ctx.csrf)}
            ${category.post_count ? `<select name="reassign_to" aria-label="Chuyển bài sang" style="border:1px solid var(--line);border-radius:6px;padding:5px 7px;background:var(--bg);color:var(--ink);font-size:12.5px"><option value="">Chuyển bài sang…</option>${categories.filter((other) => other.id !== category.id).map((other) => `<option value="${other.id}">${esc(other.name)}</option>`).join("")}</select>` : ""}
            <button class="btn btn-sm btn-danger" type="submit">Xóa</button>
          </form>
        </div></td>
      </tr>
      <tr><td colspan="6"><details class="rev"><summary>Mô tả: ${esc(category.description || "—")}</summary><div class="rev-body"><textarea form="cat-${category.id}" name="description" rows="2" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:8px;background:var(--bg);color:var(--ink)">${esc(category.description || "")}</textarea><div class="hint" style="margin-top:6px">Mô tả hiển thị ở đầu trang chuyên mục.</div></div></details></td></tr>`,
    )
    .join("");

  const table = `<div class="table-wrap"><table class="admin">
    <thead><tr><th>Tên</th><th>Slug</th><th>Nhóm</th><th>Thứ tự</th><th>Bài viết</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;

  return renderAdmin(ctx, {
    title: "Chuyên mục",
    subtitle: "Chuyên mục hiển thị trên menu và giúp người đọc tìm bài theo chủ đề.",
    active: "categories",
    actions: `<a class="btn" href="/admin/posts">← Bài viết</a>`,
    content: `${create}<div class="card"><h2>Danh sách chuyên mục</h2><p class="card-sub">Chỉ xóa được chuyên mục không còn bài viết.</p>${table}</div>`,
    wide: true,
  });
}

export function renderTags(ctx, { tags }) {
  const create = `<div class="card">
    <h2>Thêm thẻ</h2>
    <form method="post" action="/admin/tags" class="form-grid">
      ${csrfInput(ctx.csrf)}
      <div class="field"><label for="name">Tên thẻ</label><input id="name" name="name" type="text" required maxlength="60" /></div>
      <div class="field"><label for="slug">Slug</label><input id="slug" name="slug" type="text" maxlength="80" placeholder="Tự tạo nếu trống" /></div>
      <div class="full"><button class="btn btn-primary" type="submit">Tạo thẻ</button></div>
    </form>
  </div>`;

  const rows = tags
    .map(
      (tag) => `<tr>
        <td><input form="tag-${tag.id}" name="name" type="text" value="${esc(tag.name)}" required style="width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--ink)" /></td>
        <td><input form="tag-${tag.id}" name="slug" type="text" value="${esc(tag.slug)}" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--ink)" /></td>
        <td><a href="/the/${esc(tag.slug)}" target="_blank" rel="noopener">${tag.post_count}</a></td>
        <td><div class="row-actions">
          <form id="tag-${tag.id}" method="post" action="/admin/tags/${tag.id}">${csrfInput(ctx.csrf)}<button class="btn btn-sm" type="submit">Cập nhật</button></form>
          <form method="post" action="/admin/tags/${tag.id}/delete" data-confirm="Xóa thẻ ${esc(tag.name)}?">${csrfInput(ctx.csrf)}<button class="btn btn-sm btn-danger" type="submit">Xóa</button></form>
        </div></td>
      </tr>`,
    )
    .join("");

  const table = `<div class="table-wrap"><table class="admin">
    <thead><tr><th>Tên</th><th>Slug</th><th>Bài viết</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4">Chưa có thẻ.</td></tr>`}</tbody>
  </table></div>`;

  return renderAdmin(ctx, {
    title: "Thẻ nội dung",
    subtitle: "Thẻ giúp gom các bài viết cùng chủ đề nhỏ, bổ sung cho chuyên mục.",
    active: "tags",
    actions: `<a class="btn" href="/admin/posts">← Bài viết</a>`,
    content: `${create}<div class="card"><h2>Danh sách thẻ</h2><p class="card-sub">Xóa thẻ chỉ gỡ liên kết, không xóa bài viết.</p>${table}</div>`,
    wide: true,
  });
}
