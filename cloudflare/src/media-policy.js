import { parseSize, sniffImageMime } from "./image-size.js";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_MB = 8;
export const MAX_DIMENSION = 8192;
export const MAX_PIXELS = 40_000_000;

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function safeOriginalName(value, fallback = "image") {
  const name = String(value || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return name || fallback;
}

export function normalizeAlt(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

export function validateImageUpload(bytes, { originalName = "", declaredMime = "" } = {}) {
  if (!bytes || bytes.length < 12) {
    return { ok: false, status: 400, code: "invalid_image", message: "Tệp ảnh không hợp lệ." };
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, code: "too_large", message: `Ảnh vượt quá ${MAX_UPLOAD_MB} MB.` };
  }
  const mime = sniffImageMime(bytes);
  if (!mime) {
    return { ok: false, status: 400, code: "invalid_image", message: "Chỉ hỗ trợ JPG, PNG, WebP hoặc GIF." };
  }
  const declared = String(declaredMime || "").toLowerCase();
  const compatible =
    !declared ||
    declared === "application/octet-stream" ||
    declared === mime ||
    (declared === "image/jpg" && mime === "image/jpeg");
  if (!compatible) {
    return { ok: false, status: 400, code: "mime_mismatch", message: "Content-Type không khớp nội dung ảnh." };
  }
  const size = parseSize(bytes);
  if (!size?.width || !size?.height) {
    return { ok: false, status: 400, code: "invalid_image", message: "Không đọc được kích thước ảnh." };
  }
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
    return { ok: false, status: 400, code: "image_too_large", message: `Ảnh tối đa ${MAX_DIMENSION}×${MAX_DIMENSION}px.` };
  }
  if (size.width * size.height > MAX_PIXELS) {
    return { ok: false, status: 400, code: "image_too_large", message: "Ảnh có quá nhiều điểm ảnh." };
  }
  return {
    ok: true,
    mime,
    ext: EXTENSIONS[mime],
    width: size.width,
    height: size.height,
    originalName: safeOriginalName(originalName, `image.${EXTENSIONS[mime]}`),
    bytes: bytes.length,
  };
}

export function mediaUrl(filename) {
  return `/media/${encodeURIComponent(filename)}`;
}

export function mediaFilenameFromUrl(value) {
  const url = String(value || "");
  if (!url.startsWith("/media/")) return null;
  try {
    const filename = decodeURIComponent(url.slice("/media/".length));
    return /^[A-Za-z0-9._-]+$/.test(filename) ? filename : null;
  } catch {
    return null;
  }
}
