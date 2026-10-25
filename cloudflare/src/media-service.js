import {
  getMediaProvider,
  mediaEnabled,
  mediaObjectKey,
  mediaPublicUrl,
} from "./media.js";
import { normalizeAlt, validateImageUpload } from "./media-policy.js";

const MEDIA_COLUMNS = "id, filename, original_name, mime, size, width, height, alt, created_at, storage_provider, storage_key, url, sha256, status, error, updated_at";

export function serializeMedia(row) {
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    url: row.url || mediaPublicUrl(row.filename),
    provider: row.storage_provider || "r2",
    storage_key: row.storage_key || mediaObjectKey(row.filename),
    sha256: row.sha256 || "",
    status: row.status || "ready",
    error: row.error || "",
    updated_at: row.updated_at || row.created_at,
    original_name: row.original_name,
    mime: row.mime,
    size: Number(row.size || 0),
    width: row.width || null,
    height: row.height || null,
    alt: row.alt || "",
    created_at: row.created_at,
  };
}

export async function getMediaById(db, id) {
  if (!id) return null;
  return db.prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE id = ? LIMIT 1`).bind(String(id)).first();
}

export async function uploadMedia(env, { bytes, originalName, alt = "", declaredMime = "" }) {
  const provider = getMediaProvider(env);
  if (!provider.enabled) {
    return {
      error: {
        status: 501,
        code: "media_not_configured",
        message: "Media upload chưa được cấu hình. Không có provider lưu trữ nào được bật.",
      },
    };
  }
  const validated = validateImageUpload(bytes, { originalName, declaredMime });
  if (!validated.ok) return { error: validated };

  const filename = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${validated.ext}`;
  const key = mediaObjectKey(filename);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await provider.put(key, bytes, { httpMetadata: { contentType: validated.mime } });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    filename,
    original_name: validated.originalName,
    mime: validated.mime,
    size: validated.bytes,
    width: validated.width,
    height: validated.height,
    alt: normalizeAlt(alt),
    created_at: now,
    storage_provider: "r2",
    storage_key: key,
    url: mediaPublicUrl(filename),
    sha256,
    status: "ready",
    error: "",
    updated_at: now,
  };
  try {
    await env.DB.prepare(
      `INSERT INTO media (id, filename, original_name, mime, size, width, height, alt, created_at, storage_provider, storage_key, url, sha256, status, error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(row.id, row.filename, row.original_name, row.mime, row.size, row.width, row.height, row.alt, row.created_at, row.storage_provider, row.storage_key, row.url, row.sha256, row.status, row.error, row.updated_at)
      .run();
  } catch (error) {
    await provider.delete(key).catch(() => {});
    throw error;
  }
  return { data: serializeMedia(row) };
}

export async function deleteMediaById(env, id) {
  const row = await getMediaById(env.DB, id);
  if (!row) return { error: { status: 404, code: "not_found", message: "Ảnh không tồn tại." } };
  const usage = await env.DB.prepare("SELECT COUNT(*) AS n FROM media_usages WHERE media_id = ?").bind(row.id).first();
  if (Number(usage?.n || 0) > 0) {
    return { error: { status: 409, code: "media_in_use", message: "Ảnh đang được dùng trong bài viết." } };
  }
  if ((row.storage_provider || "r2") === "static") {
    return {
      error: {
        status: 409,
        code: "media_static_managed",
        message: "Ảnh Static Assets được quản lý bởi deploy runner; không xóa trực tiếp từ Worker.",
      },
    };
  }
  const provider = getMediaProvider(env);
  if (!provider.enabled) {
    return { error: { status: 501, code: "media_not_configured", message: "Media storage chưa được cấu hình." } };
  }
  await provider.delete(mediaObjectKey(row.filename));
  await env.DB.prepare("DELETE FROM media WHERE id = ?").bind(row.id).run();
  return { data: serializeMedia(row) };
}

export async function resolveCoverMedia(env, mediaId) {
  const row = await getMediaById(env.DB, mediaId);
  if (!row) {
    return { error: { status: 400, code: "invalid_media", message: "cover_media_id không tồn tại." } };
  }
  if ((row.status || "ready") !== "ready") {
    return { error: { status: 409, code: "media_not_ready", message: "Ảnh chưa sẵn sàng để dùng cho bài viết." } };
  }
  if ((row.storage_provider || "r2") !== "static" && !mediaEnabled(env)) {
    return { error: { status: 501, code: "media_not_configured", message: "Media provider chưa được cấu hình." } };
  }
  return { data: serializeMedia(row) };
}

export async function syncMediaUsages(db, postId) {
  const post = await db
    .prepare("SELECT cover_image, og_image, content_html FROM posts WHERE id = ? LIMIT 1")
    .bind(postId)
    .first();
  if (!post) return;
  const urls = new Set();
  for (const value of [post.cover_image, post.og_image]) {
    if (String(value || "").startsWith("/media/")) urls.add(String(value));
  }
  const regex = /(?:src|href)=["'](\/media\/[^"']+)["']/gi;
  let match;
  while ((match = regex.exec(post.content_html || ""))) urls.add(match[1]);
  await db.prepare("DELETE FROM media_usages WHERE post_id = ?").bind(postId).run();
  if (!urls.size) return;
  const placeholders = [...urls].map(() => "?").join(",");
  await db
    .prepare(
      `INSERT OR IGNORE INTO media_usages (media_id, post_id)
       SELECT id, ? FROM media WHERE status = 'ready' AND url IN (${placeholders})`,
    )
    .bind(postId, ...urls)
    .run();
}

export function mediaUrlsForPost(post = {}) {
  const urls = new Set();
  for (const value of [post.coverImage ?? post.cover_image, post.ogImage ?? post.og_image]) {
    if (String(value || "").startsWith("/media/")) urls.add(String(value));
  }
  const regex = /(?:src|href)=["'](\/media\/[^"']+)["']/gi;
  let match;
  while ((match = regex.exec(String(post.contentHtml ?? post.content_html ?? "")))) urls.add(match[1]);
  return [...urls];
}

export async function assertMediaReady(db, post) {
  const urls = mediaUrlsForPost(post);
  if (!urls.length) return;
  const placeholders = urls.map(() => "?").join(",");
  const rows = await db
    .prepare(`SELECT url FROM media WHERE status = 'ready' AND url IN (${placeholders})`)
    .bind(...urls)
    .all();
  const ready = new Set((rows.results || []).map((row) => row.url));
  const pending = urls.filter((url) => !ready.has(url));
  if (pending.length) {
    const error = new Error("Bài viết có ảnh chưa READY; không thể xuất bản.");
    error.code = "MEDIA_NOT_READY";
    error.urls = pending.slice(0, 10);
    throw error;
  }
}
