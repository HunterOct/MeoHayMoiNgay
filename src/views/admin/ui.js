import { esc } from "../helpers.js";
import { formatDateTime } from "../../lib/time.js";
import { STATUS_LABELS, ROLE_LABELS } from "../../lib/permissions.js";

const FLASH = {
  saved: "Đã lưu thay đổi.",
  created: "Đã tạo bài viết.",
  published: "Đã xuất bản bài viết.",
  scheduled: "Đã lên lịch xuất bản.",
  submitted: "Đã gửi bài chờ duyệt.",
  unpublished: "Đã chuyển bài về nháp.",
  archived: "Đã lưu trữ bài viết.",
  trashed: "Đã chuyển vào thùng rác.",
  restored: "Đã khôi phục bài viết.",
  purged: "Đã xóa vĩnh viễn.",
  uploaded: "Đã tải ảnh lên.",
  media_deleted: "Đã xóa ảnh.",
  media_updated: "Đã cập nhật mô tả ảnh.",
  category_created: "Đã tạo chuyên mục.",
  category_updated: "Đã cập nhật chuyên mục.",
  category_deleted: "Đã xóa chuyên mục.",
  tag_created: "Đã tạo thẻ.",
  tag_updated: "Đã cập nhật thẻ.",
  tag_deleted: "Đã xóa thẻ.",
  user_created: "Đã tạo tài khoản.",
  user_updated: "Đã cập nhật tài khoản.",
  password_reset: "Đã đặt lại mật khẩu.",
  client_created: "Đã tạo API client.",
  client_updated: "Đã cập nhật API client.",
  client_revoked: "Đã thu hồi API key.",
  client_rotated: "Đã xoay vòng API key.",
  settings_saved: "Đã lưu cài đặt.",
  revision_restored: "Đã khôi phục phiên bản.",
  logged_out: "Đã đăng xuất.",
  bulk_done: "Đã áp dụng thao tác hàng loạt.",
  nothing_selected: "Bạn chưa chọn bài viết nào.",
};

const ERRORS = {
  invalid: "Thông tin gửi lên không hợp lệ.",
  credentials: "Email hoặc mật khẩu không đúng.",
  locked: "Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau 15 phút.",
  rate: "Bạn thử đăng nhập quá nhiều lần. Chờ một lát rồi thử lại.",
  csrf: "Phiên làm việc hết hạn. Tải lại trang và thử lại.",
  forbidden: "Bạn không có quyền thực hiện thao tác này.",
  not_found: "Không tìm thấy nội dung.",
  missing_fields: "Vui lòng nhập tiêu đề và nội dung.",
  schedule_required: "Vui lòng chọn thời điểm xuất bản.",
  scheduled_past: "Thời điểm lên lịch phải ở tương lai.",
  category_in_use: "Chuyên mục đang có bài viết. Hãy chuyển bài sang chuyên mục khác trước.",
  media_in_use: "Ảnh đang được dùng trong bài viết, không thể xóa.",
  invalid_image: "Tệp tải lên không phải ảnh JPG, PNG, WebP hoặc GIF hợp lệ.",
  too_large: "Ảnh vượt quá dung lượng cho phép.",
  upload_failed: "Tải ảnh thất bại. Thử lại với tệp nhỏ hơn.",
  password_weak: "Mật khẩu cần tối thiểu 10 ký tự, có cả chữ và số.",
  email_taken: "Email này đã được sử dụng.",
  invalid_url: "Đường dẫn không hợp lệ (chỉ chấp nhận http/https hoặc đường dẫn nội bộ).",
  admin_self: "Không thể tự khóa hoặc hạ quyền chính mình.",
  last_admin: "Hệ thống cần ít nhất một quản trị viên đang hoạt động.",
  invalid_key: "API key không hợp lệ.",
  slug_taken: "Slug đã tồn tại, hãy chọn slug khác.",
  duplicate: "Tên hoặc slug đã tồn tại.",
  invalid_status: "Trạng thái không hợp lệ.",
};

export function flashFromQuery(query = {}) {
  if (query.msg && FLASH[query.msg]) return { type: "ok", message: FLASH[query.msg] };
  if (query.err && ERRORS[query.err]) return { type: "err", message: ERRORS[query.err] };
  return null;
}

export function errorMessage(code) {
  return ERRORS[code] || "Đã có lỗi xảy ra.";
}

export const csrfInput = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf)}" />`;

export function statusBadge(status, deleted = false) {
  if (deleted) return '<span class="badge trash">Thùng rác</span>';
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge ${esc(status)}">${esc(label)}</span>`;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

export function statusOptions(selected) {
  return Object.entries(STATUS_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}"${value === selected ? " selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
}

export function adminPager({ page, totalPages, base, query = {} }) {
  if (totalPages <= 1) return "";
  const urlFor = (n) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "" && key !== "page") params.set(key, value);
    }
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const parts = [];
  parts.push(
    page > 1
      ? `<a href="${urlFor(page - 1)}" aria-label="Trang trước">‹</a>`
      : `<span aria-hidden="true">‹</span>`,
  );
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let n = start; n <= end; n += 1) {
    parts.push(n === page ? `<span class="active" aria-current="page">${n}</span>` : `<a href="${urlFor(n)}">${n}</a>`);
  }
  parts.push(
    page < totalPages
      ? `<a href="${urlFor(page + 1)}" aria-label="Trang sau">›</a>`
      : `<span aria-hidden="true">›</span>`,
  );
  return `<nav class="pagination" aria-label="Phân trang">${parts.join("")}</nav>`;
}

export function adminDate(value) {
  return value ? formatDateTime(value) : "—";
}

export function bytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function textCounter(value, max) {
  const length = String(value || "").length;
  return `<div class="counter${length > max ? " over" : ""}">${length}/${max}</div>`;
}

export function formatMeta(meta) {
  if (!meta || (typeof meta === "object" && !Object.keys(meta).length)) return "—";
  const text = JSON.stringify(meta);
  return `<span class="audit-meta">${esc(text.length > 320 ? `${text.slice(0, 320)}…` : text)}</span>`;
}

export function optionCategories(categories, selected) {
  return categories
    .map(
      (category) =>
        `<option value="${esc(category.id)}"${category.id === selected ? " selected" : ""}>${esc(category.name)}</option>`,
    )
    .join("");
}

export function optionUsers(users, selected) {
  return users
    .map(
      (user) =>
        `<option value="${esc(user.id)}"${user.id === selected ? " selected" : ""}>${esc(user.name)} (${esc(user.email)})</option>`,
    )
    .join("");
}
