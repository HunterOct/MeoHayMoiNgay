import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { statusBadge, csrfInput, adminDate, optionCategories, optionUsers } from "./ui.js";
import { toLocalInput } from "../../lib/time.js";

function fieldError(error) {
  return error ? `<div class="flash err" role="alert">${esc(error)}</div>` : "";
}

export function renderEditor(ctx, { post, isNew, categories, users, canPublish, error = "" }) {
  const action = isNew ? "/admin/posts" : `/admin/posts/${post.id}`;
  const tags = Array.isArray(post.tags)
    ? post.tags.map((tag) => (typeof tag === "string" ? tag : tag.name)).join(", ")
    : "";
  const isPublished = post.status === "published";
  const isScheduled = post.status === "scheduled";
  const authorName = post.author_name || ctx.user.name;

  const statusLine = `<div class="status-line"><span>Trạng thái</span>${statusBadge(post.status || "draft", Boolean(post.deleted_at))}</div>`;

  const main = `<div class="card">
    <div class="field">
      <label for="title">Tiêu đề</label>
      <input id="title" name="title" type="text" required maxlength="200" value="${esc(post.title || "")}" placeholder="Ví dụ: Wifi nhà chậm, lag khi xem YouTube? 7 cách khắc phục" data-counter="200" />
      <div class="hint" id="titleCounter"></div>
    </div>
    <div class="field">
      <label for="slug">Slug (URL)</label>
      <input id="slug" name="slug" type="text" maxlength="120" value="${esc(post.slug || "")}" placeholder="Để trống sẽ tự tạo từ tiêu đề" />
      <div class="slug-preview">URL: <code>/bai-viet/<span id="slugPreview">${esc(post.slug || "…")}</span></code></div>
    </div>
    <div class="field">
      <label for="excerpt">Mô tả ngắn (dùng cho thẻ bài, SEO nếu trống)</label>
      <textarea id="excerpt" name="excerpt" rows="3" maxlength="500" data-counter="300">${esc(post.excerpt || "")}</textarea>
      <div class="hint" id="excerptCounter"></div>
    </div>
    <div class="field">
      <label for="lede">Đoạn mở đầu (lede)</label>
      <textarea id="lede" name="lede" rows="3" maxlength="600">${esc(post.lede || "")}</textarea>
      <div class="hint">Hiển thị ngay dưới tiêu đề bài viết. Có thể bỏ trống.</div>
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px">
        <label for="content" style="margin:0">Nội dung</label>
        <select id="contentFormat" name="content_format" style="width:auto;padding:4px 8px;font-size:12.5px">
          <option value="markdown"${(post.content_format || "markdown") === "markdown" ? " selected" : ""}>Markdown</option>
          <option value="html"${post.content_format === "html" ? " selected" : ""}>HTML</option>
        </select>
      </div>
      <div class="editor-toolbar" data-toolbar>
        <button type="button" data-insert="h2">H2</button>
        <button type="button" data-insert="h3">H3</button>
        <button type="button" data-insert="bold"><b>B</b></button>
        <button type="button" data-insert="italic"><i>I</i></button>
        <button type="button" data-insert="ul">Danh sách</button>
        <button type="button" data-insert="ol">Số thứ tự</button>
        <button type="button" data-insert="quote">Trích dẫn</button>
        <button type="button" data-insert="link">Liên kết</button>
        <button type="button" data-insert="image">Ảnh</button>
      </div>
      <textarea id="content" name="content" class="content-editor" spellcheck="true">${esc(post.content_source || "")}</textarea>
      <div class="hint">Markdown được làm sạch và render thành HTML khi lưu. HTML thô cũng được lọc theo danh sách thẻ an toàn.</div>
    </div>
  </div>`;

  const side = `<div class="editor-side">
    <div class="card publish-box">
      <h2 style="font-size:17px">Xuất bản</h2>
      ${statusLine}
      ${isScheduled ? `<p class="text-muted">Hẹn đăng: ${adminDate(post.scheduled_at)}</p>` : ""}
      ${isPublished ? `<p class="text-muted">Đã đăng: ${adminDate(post.published_at)}</p>` : ""}
      <button class="btn btn-primary" type="submit" name="action" value="save">${isNew ? "Lưu nháp" : "Lưu thay đổi"}</button>
      <button class="btn" type="submit" name="action" value="review">Gửi duyệt</button>
      ${canPublish ? `<button class="btn btn-primary" type="submit" name="action" value="publish">Xuất bản ngay</button>` : ""}
      ${canPublish ? `<div class="field" style="margin-top:12px"><label for="scheduled_at_input">Lên lịch xuất bản</label><input id="scheduled_at_input" name="scheduled_at_input" type="datetime-local" value="${esc(toLocalInput(post.scheduled_at))}" /><div class="hint">Múi giờ ${esc(ctx.timezoneLabel || "Asia/Ho_Chi_Minh")}. Áp dụng khi bấm “Lên lịch”.</div></div><button class="btn" type="submit" name="action" value="schedule">Lên lịch</button>` : ""}
      ${canPublish && isPublished ? `<button class="btn" type="submit" name="action" value="draft">Chuyển về nháp</button>` : ""}
      ${canPublish && (isPublished || isScheduled) ? `<button class="btn" type="submit" name="action" value="archive">Lưu trữ</button>` : ""}
      <div class="meta-list">
        ${isNew ? "<span>Bài mới chưa được lưu.</span>" : `<span>Cập nhật: ${adminDate(post.updated_at)}</span><span>Lượt xem: ${post.views || 0}</span><span>Thời gian đọc: ${post.read_minutes || 1} phút</span>`}
      </div>
      ${!isNew ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-sm" href="/admin/posts/${post.id}/preview">Xem trước</a><a class="btn btn-sm" href="/admin/posts/${post.id}/revisions">Lịch sử</a>${post.status === "published" ? `<a class="btn btn-sm" href="/bai-viet/${encodeURIComponent(post.slug)}" target="_blank" rel="noopener">Xem</a>` : ""}</div>` : ""}
    </div>

    <div class="card">
      <h2 style="font-size:17px">Phân loại</h2>
      <div class="field">
        <label for="category_id">Chuyên mục</label>
        <select id="category_id" name="category_id"><option value="">— Chưa phân loại —</option>${optionCategories(categories, post.category_id)}</select>
      </div>
      <div class="field">
        <label for="tags">Thẻ (cách nhau bằng dấu phẩy)</label>
        <input id="tags" name="tags" type="text" value="${esc(tags)}" placeholder="wifi chậm, router" />
      </div>
      ${ctx.user.role === "author"
        ? `<div class="field"><label>Tác giả</label><input type="text" value="${esc(authorName)}" disabled /></div>`
        : `<div class="field"><label for="author_id">Tác giả</label><select id="author_id" name="author_id">${optionUsers(users, post.author_id || ctx.user.id)}</select></div>`}
    </div>

    <div class="card">
      <h2 style="font-size:17px">Ảnh đại diện</h2>
      <div class="field">
        <label for="cover_image">Đường dẫn ảnh</label>
        <div class="row"><input id="cover_image" name="cover_image" type="text" value="${esc(post.cover_image || "")}" placeholder="/media/hoac-duong-dan.jpg" /><button class="btn btn-sm" type="button" data-open-media data-target="#cover_image">Chọn</button></div>
        <div class="hint"><a href="/admin/media" target="_blank" rel="noopener">Mở thư viện ảnh</a> · hỗ trợ JPG, PNG, WebP, GIF.</div>
      </div>
      ${post.cover_image ? `<img id="coverPreview" src="${esc(post.cover_image)}" alt="" style="width:100%;border-radius:10px;aspect-ratio:16/10;object-fit:cover" />` : `<img id="coverPreview" alt="" style="width:100%;border-radius:10px;aspect-ratio:16/10;object-fit:cover;display:none" />`}
      <div class="field" style="margin-top:12px"><label for="cover_alt">Alt text</label><input id="cover_alt" name="cover_alt" type="text" maxlength="300" value="${esc(post.cover_alt || "")}" /></div>
      <div class="field"><label for="cover_caption">Chú thích ảnh</label><input id="cover_caption" name="cover_caption" type="text" maxlength="300" value="${esc(post.cover_caption || "")}" /></div>
    </div>

    <div class="card">
      <h2 style="font-size:17px">SEO &amp; metadata</h2>
      <div class="field"><label for="seo_title">SEO title</label><input id="seo_title" name="seo_title" type="text" maxlength="80" value="${esc(post.seo_title || "")}" data-counter="70" /><div class="hint" id="seoTitleCounter"></div></div>
      <div class="field"><label for="seo_description">Meta description</label><textarea id="seo_description" name="seo_description" rows="3" maxlength="220" data-counter="170">${esc(post.seo_description || post.excerpt || "")}</textarea><div class="hint" id="seoDescCounter"></div></div>
      <div class="field"><label for="focus_keyword">Từ khóa chính</label><input id="focus_keyword" name="focus_keyword" type="text" maxlength="100" value="${esc(post.focus_keyword || "")}" /></div>
      <div class="field"><label for="canonical_url">Canonical URL (tuỳ chọn)</label><input id="canonical_url" name="canonical_url" type="text" maxlength="300" value="${esc(post.canonical_url || "")}" placeholder="https://..." /><div class="hint">Chỉ dùng khi bài gốc nằm ở nơi khác. Để trống để dùng URL của bài.</div></div>
      <div class="field"><label for="og_image">Ảnh chia sẻ (OG)</label><div class="row"><input id="og_image" name="og_image" type="text" value="${esc(post.og_image || "")}" /><button class="btn btn-sm" type="button" data-open-media data-target="#og_image">Chọn</button></div></div>
      <div class="field"><label for="read_minutes">Thời gian đọc (phút)</label><input id="read_minutes" name="read_minutes" type="number" min="1" max="120" value="${esc(post.read_minutes || "")}" placeholder="Tự tính nếu trống" /></div>
      <label class="check"><input type="checkbox" name="is_featured" value="1"${post.is_featured ? " checked" : ""} /> Đưa vào bài nổi bật</label>
    </div>
  </div>`;

  const danger =
    !isNew && !post.deleted_at
      ? `<div class="danger-zone" style="margin-top:22px"><p class="text-muted" style="margin:0 0 8px">Vùng nguy hiểm</p><form method="post" action="/admin/posts/${post.id}/delete" data-confirm="Chuyển bài viết vào thùng rác?">${csrfInput(ctx.csrf)}<button class="btn btn-sm btn-danger" type="submit">Chuyển vào thùng rác</button></form></div>`
      : "";

  return renderAdmin(ctx, {
    title: isNew ? "Tạo bài viết" : "Sửa bài viết",
    subtitle: isNew ? "Soạn nội dung, chọn chuyên mục và lưu nháp trước khi xuất bản." : `Cập nhật lần cuối ${adminDate(post.updated_at)}`,
    active: isNew ? "new" : "posts",
    actions: `<a class="btn" href="/admin/posts">← Danh sách</a>`,
    wide: true,
    content: `<form method="post" action="${action}" id="postForm">
      ${csrfInput(ctx.csrf)}
      ${fieldError(error)}
      <div class="editor-layout">
        <div class="editor-main">${main}</div>
        ${side}
      </div>
    </form>
    ${danger}`,
  });
}
