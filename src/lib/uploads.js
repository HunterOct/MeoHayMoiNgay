import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { sniffImageMime, imageSize } from "./image-size.js";
import { createMedia } from "../db/media.js";
import { badRequest } from "./errors.js";

const EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function cleanOriginalName(name) {
  return path.basename(String(name || "image")).replace(/[^\p{L}\p{N}._ -]/gu, "").slice(0, 160) || "image";
}

export function storeImage({ buffer, originalName, alt = "", uploadedBy = null }) {
  if (!buffer || !buffer.length) throw badRequest("Tệp rỗng.", { code: "invalid_image" });
  if (buffer.length > config.maxUploadBytes) {
    throw badRequest("Ảnh vượt quá dung lượng cho phép.", { code: "too_large" });
  }
  const mime = sniffImageMime(buffer);
  if (!mime) throw badRequest("Định dạng ảnh không hợp lệ.", { code: "invalid_image" });
  const ext = EXT[mime];
  const filename = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const fullPath = path.join(config.uploadDir, filename);
  fs.writeFileSync(fullPath, buffer, { mode: 0o644 });
  const dims = imageSize(fullPath);
  return createMedia({
    filename,
    originalName: cleanOriginalName(originalName),
    mime,
    size: buffer.length,
    width: dims?.width || null,
    height: dims?.height || null,
    alt: String(alt || "").slice(0, 300),
    uploadedBy,
  });
}

export function deleteImageFile(filename) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpg|jpeg|png|webp|gif)$/i.test(String(filename || ""))) return;
  const full = path.resolve(config.uploadDir, filename);
  if (!full.startsWith(path.resolve(config.uploadDir) + path.sep)) return;
  try {
    fs.unlinkSync(full);
  } catch {
    // File already gone; the DB row is still removed by the caller.
  }
}
