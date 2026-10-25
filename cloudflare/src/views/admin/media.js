import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { adminPager, csrfInput, bytes, adminDate } from "./ui.js";

export function renderMedia(ctx, { result, q = "", pick = false, legacy = [] }) {
  const actions = `<a class="btn" href="/admin/posts">← Bài viết</a>`;
  const assetCount = Number(ctx.settings?.media_asset_count || 0);
  const assetLimit = Number(ctx.settings?.media_asset_limit || 0);
  const assetBanner = assetCount
    ? `<div class="flash ${assetLimit && assetCount >= assetLimit * 0.9 ? "err" : "ok"}" role="status">Static Assets: ${assetCount}${assetLimit ? ` / ${assetLimit}` : ""} file.${assetLimit && assetCount >= assetLimit * 0.9 ? " Gần giới hạn — tạm ngừng nhận ảnh mới và archive theo runbook." : ""}</div>`
    : "";
  const upload = ctx.mediaUploadEnabled
    ? `<div class="card">
    <h2>Tải ảnh mới</h2>
    <p class="card-sub">JPG, PNG, WebP hoặc GIF. Tối đa ${ctx.maxUploadMb} MB, 8192×8192 px. Ảnh được kiểm tra MIME/kích thước và phục vụ từ /media/.</p>
    <form method="post" action="/admin/media" enctype="multipart/form-data" class="upload-box">
      ${csrfInput(ctx.csrf)}
      <div class="field"><label for="file">Tệp ảnh</label><input id="file" type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif" required /></div>
      <div class="field"><label for="alt">Alt text</label><input id="alt" type="text" name="alt" maxlength="300" placeholder="Mô tả ngắn cho ảnh" /></div>
      <button class="btn btn-primary" type="submit">Tải lên</button>
    </form>
  </div>`
    : `<div class="card">
    <h2>Tải ảnh mới</h2>
    <div class="flash err" role="status">Static Assets không nhận upload trực tiếp từ Worker. Ảnh được nhập qua trusted deploy runner (xem <code>docs/STATIC-ASSETS-MEDIA.md</code>), sau đó xuất hiện ở trạng thái READY bên dưới.</div>
  </div>`;

  const search = `<form class="filters" method="get" action="/admin/media">
    <div class="field"><label for="q">Tìm ảnh</label><input id="q" type="search" name="q" value="${esc(q)}" placeholder="Tên tệp hoặc alt" /></div>
    <button class="btn" type="submit">Tìm</button>
    ${pick ? '<span class="badge">Chọn ảnh cho bài viết</span>' : ""}
  </form>`;

  const items = [...(result.items || []), ...(legacy || [])];
  const grid = items.length
    ? `<div class="media-grid">${items
        .map(
          (item) => `<div class="media-item">
            <img src="${esc(item.url || `/media/${encodeURIComponent(item.filename)}`)}" alt="${esc(item.alt || item.original_name)}" loading="lazy" />
            <div class="mbody">
              <span class="mname">${esc(item.original_name)}</span>
              <span class="mmeta">${item.width && item.height ? `${item.width}×${item.height} · ` : ""}${item.legacy ? "Ảnh legacy" : bytes(item.size)}${item.created_at ? ` · ${adminDate(item.created_at)}` : ""}</span>
              <span class="mmeta">${item.status || "ready"}${item.provider === "static" ? " · Static Assets" : ""} · ${item.usage_count ? `Đang dùng trong ${item.usage_count} bài` : "Chưa được dùng"}</span>
              <span class="mmeta"><a href="${esc(item.url || `/media/${encodeURIComponent(item.filename)}`)}" target="_blank" rel="noopener">${esc(item.url || `/media/${item.filename}`)}</a></span>
              ${pick ? `<div class="pick-actions"><button type="button" data-pick-url="${esc(item.url || `/media/${item.filename}`)}">Chèn ảnh</button></div>` : ""}
              ${item.legacy ? "" : `<form method="post" action="/admin/media/${item.id}/alt">${csrfInput(ctx.csrf)}<input type="text" name="alt" value="${esc(item.alt || "")}" maxlength="300" aria-label="Alt text" /><button class="btn btn-sm" type="submit">Lưu</button></form>
              <form method="post" action="/admin/media/${item.id}/delete" data-confirm="${item.usage_count ? "Ảnh đang được dùng, không thể xóa. Vẫn thử?" : "Xóa ảnh này?"}">${csrfInput(ctx.csrf)}<button class="btn btn-sm btn-danger" type="submit"${item.usage_count || item.provider === "static" ? " disabled" : ""}>Xóa</button></form>`}
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
    content: `${assetBanner}${upload}${search}${grid}${adminPager({ page: result.page, totalPages: result.totalPages, base: "/admin/media", query: { q } })}
      <p class="text-muted" style="margin-top:14px">Tổng: ${result.total} ảnh.</p>`,
  });
}
