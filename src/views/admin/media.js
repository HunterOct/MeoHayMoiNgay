import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { adminPager, csrfInput, bytes, adminDate } from "./ui.js";

export function renderMedia(ctx, { result, q = "", pick = false }) {
  const actions = `<a class="btn" href="/admin/posts">← Bài viết</a>`;
  const upload = `<div class="card">
    <h2>Tải ảnh mới</h2>
    <p class="card-sub">JPG, PNG, WebP hoặc GIF. Tối đa ${ctx.maxUploadMb} MB mỗi tệp. Ảnh được làm sạch tên và phục vụ từ /media/.</p>
    <form method="post" action="/admin/media" enctype="multipart/form-data" class="upload-box">
      ${csrfInput(ctx.csrf)}
      <div class="field"><label for="file">Tệp ảnh</label><input id="file" type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif" required /></div>
      <div class="field"><label for="alt">Alt text</label><input id="alt" type="text" name="alt" maxlength="300" placeholder="Mô tả ngắn cho ảnh" /></div>
      <button class="btn btn-primary" type="submit">Tải lên</button>
    </form>
  </div>`;

  const search = `<form class="filters" method="get" action="/admin/media">
    <div class="field"><label for="q">Tìm ảnh</label><input id="q" type="search" name="q" value="${esc(q)}" placeholder="Tên tệp hoặc alt" /></div>
    <button class="btn" type="submit">Tìm</button>
    ${pick ? '<span class="badge">Chọn ảnh cho bài viết</span>' : ""}
  </form>`;

  const grid = result.items.length
    ? `<div class="media-grid">${result.items
        .map(
          (item) => `<div class="media-item">
            <img src="/media/${encodeURIComponent(item.filename)}" alt="${esc(item.alt || item.original_name)}" loading="lazy" />
            <div class="mbody">
              <span class="mname">${esc(item.original_name)}</span>
              <span class="mmeta">${item.width && item.height ? `${item.width}×${item.height} · ` : ""}${bytes(item.size)} · ${adminDate(item.created_at)}</span>
              <span class="mmeta">${item.usage_count ? `Đang dùng trong ${item.usage_count} bài` : "Chưa được dùng"}</span>
              ${pick ? `<div class="pick-actions"><button type="button" data-pick-url="/media/${esc(item.filename)}">Chèn ảnh</button></div>` : ""}
              <form method="post" action="/admin/media/${item.id}/alt">${csrfInput(ctx.csrf)}<input type="text" name="alt" value="${esc(item.alt || "")}" maxlength="300" aria-label="Alt text" /><button class="btn btn-sm" type="submit">Lưu</button></form>
              <form method="post" action="/admin/media/${item.id}/delete" data-confirm="${item.usage_count ? "Ảnh đang được dùng, không thể xóa. Vẫn thử?" : "Xóa ảnh này?"}">${csrfInput(ctx.csrf)}<button class="btn btn-sm btn-danger" type="submit"${item.usage_count ? " disabled" : ""}>Xóa</button></form>
            </div>
          </div>`,
        )
        .join("")}</div>`
    : `<div class="empty-state"><b>Chưa có ảnh</b>Tải ảnh đầu tiên ở phía trên.</div>`;

  return renderAdmin(ctx, {
    title: "Thư viện ảnh",
    subtitle: pick ? "Chọn một ảnh để dùng làm ảnh đại diện hoặc ảnh chia sẻ." : "Quản lý ảnh dùng trong bài viết.",
    active: "media",
    actions,
    wide: true,
    content: `${upload}${search}${grid}${adminPager({ page: result.page, totalPages: result.totalPages, base: "/admin/media", query: { q } })}
      <p class="text-muted" style="margin-top:14px">Tổng: ${result.total} ảnh.</p>`,
  });
}
