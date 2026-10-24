import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { csrfInput, adminDate } from "./ui.js";

export function renderRevisions(ctx, { post, revisions }) {
  const list = revisions.length
    ? revisions
        .map(
          (rev, index) => `<details class="rev"${index === 0 ? " open" : ""}>
            <summary><span>${adminDate(rev.created_at)} · ${esc(rev.title)}</span><span class="badge ${esc(rev.status)}">${esc(rev.status)}</span></summary>
            <div class="rev-body">
              <p class="text-muted">Sửa bởi: ${esc(rev.edited_by_type)} ${esc(String(rev.edited_by_id || "").slice(0, 8))}</p>
              <pre>${esc(rev.content_source || rev.content_html || "")}</pre>
              <form method="post" action="/admin/posts/${post.id}/revisions/${rev.id}/restore" data-confirm="Khôi phục nội dung từ phiên bản này? Bản hiện tại sẽ được lưu thành một phiên bản mới.">${csrfInput(ctx.csrf)}<button class="btn btn-sm" type="submit">Khôi phục phiên bản này</button></form>
            </div>
          </details>`,
        )
        .join("")
    : `<div class="empty-state"><b>Chưa có phiên bản</b>Mỗi lần lưu bài, hệ thống tạo một bản ghi để có thể quay lại.</div>`;

  const content = `<div class="card">
    <h2>${esc(post.title)}</h2>
    <p class="card-sub">Hiện tại: ${esc(post.status)} · cập nhật ${adminDate(post.updated_at)} · ${revisions.length} phiên bản gần nhất</p>
    <p><a class="btn btn-sm" href="/admin/posts/${post.id}/edit">← Về trình soạn thảo</a></p>
    ${list}
  </div>`;

  return renderAdmin(ctx, {
    title: "Lịch sử chỉnh sửa",
    subtitle: "Mỗi lần lưu tạo một phiên bản. Có thể xem nội dung và khôi phục.",
    active: "posts",
    content,
    wide: true,
  });
}
