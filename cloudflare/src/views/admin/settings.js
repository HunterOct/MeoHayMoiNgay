import { esc } from "../helpers.js";
import { renderAdmin } from "./layout.js";
import { csrfInput, optionUsers } from "./ui.js";

export function renderSettings(ctx, { settings, users, info }) {
  const content = `<div class="card">
    <h2>Thông tin website</h2>
    <p class="card-sub">Các thông tin này dùng cho header, footer, OG tags và dữ liệu có cấu trúc.</p>
    <form method="post" action="/admin/settings">
      ${csrfInput(ctx.csrf)}
      <div class="form-grid">
        <div class="field"><label for="site_name">Tên website</label><input id="site_name" name="site_name" type="text" required maxlength="80" value="${esc(settings.site_name)}" /></div>
        <div class="field"><label for="contact_email">Email liên hệ</label><input id="contact_email" name="contact_email" type="email" maxlength="200" value="${esc(settings.contact_email)}" /></div>
        <div class="field full"><label for="site_tagline">Tagline</label><input id="site_tagline" name="site_tagline" type="text" maxlength="160" value="${esc(settings.site_tagline)}" /></div>
        <div class="field full"><label for="site_description">Mô tả website (meta description mặc định)</label><textarea id="site_description" name="site_description" rows="3" maxlength="320">${esc(settings.site_description)}</textarea></div>
        <div class="field"><label for="social_twitter">X / Twitter</label><input id="social_twitter" name="social_twitter" type="text" maxlength="120" value="${esc(settings.social_twitter)}" placeholder="@handle" /></div>
        <div class="field"><label for="social_facebook">Facebook</label><input id="social_facebook" name="social_facebook" type="text" maxlength="200" value="${esc(settings.social_facebook)}" placeholder="https://facebook.com/..." /></div>
        <div class="field"><label for="default_author_id">Tác giả mặc định cho API</label><select id="default_author_id" name="default_author_id"><option value="">Tự chọn quản trị viên đầu tiên</option>${optionUsers(users, settings.default_author_id)}</select><div class="hint">Bài do hệ thống AI gửi lên sẽ gán cho tài khoản này.</div></div>
        <div class="field full"><label for="copyright">Dòng bản quyền / lưu ý</label><textarea id="copyright" name="copyright" rows="2" maxlength="400">${esc(settings.copyright)}</textarea></div>
        <div class="full"><label class="check"><input type="checkbox" name="allow_ai_crawlers" value="1"${settings.allow_ai_crawlers === "1" ? " checked" : ""} /> Cho phép crawler AI (GPTBot, CCBot, ClaudeBot…) truy cập nội dung</label><div class="hint">Mặc định tắt để hạn chế dùng nội dung huấn luyện AI. Googlebot, Bingbot vẫn được phép trong mọi trường hợp.</div></div>
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top:8px">Lưu cài đặt</button>
    </form>
  </div>

  <div class="card">
    <h2>Môi trường hệ thống</h2>
    <p class="card-sub">Thông tin chỉ đọc, không chứa bí mật.</p>
    <div class="table-wrap"><table class="admin">
      <tbody>
        <tr><th>Site URL</th><td class="mono">${esc(info.siteUrl)}</td></tr>
        <tr><th>Môi trường</th><td class="mono">${esc(info.nodeEnv)}</td></tr>
        <tr><th>Node.js</th><td class="mono">${esc(info.nodeVersion)}</td></tr>
        <tr><th>SQLite</th><td class="mono">${esc(info.dbVersion)} · schema v${info.schemaVersion}</td></tr>
        <tr><th>Database</th><td class="mono">${esc(info.dbPath)}</td></tr>
        <tr><th>Thư mục ảnh</th><td class="mono">${esc(info.uploadDir)}</td></tr>
        <tr><th>Chặn AI crawler</th><td>${info.blockAi ? '<span class="badge published">Đang chặn</span>' : '<span class="badge review">Đang cho phép</span>'}</td></tr>
        <tr><th>Cookie bảo mật</th><td>${info.secureCookies ? '<span class="badge published">HTTPS-only</span>' : '<span class="badge draft">Chưa bật (dev)</span>'}</td></tr>
      </tbody>
    </table></div>
  </div>`;

  return renderAdmin(ctx, {
    title: "Cài đặt",
    subtitle: "Thông tin chung, tác giả mặc định cho API và chính sách crawler.",
    active: "settings",
    content,
  });
}
