import { DurableObject } from "cloudflare:workers";
import { plainText } from "./text.js";
import {
  createAdminPost,
  updateAdminPost,
  getAdminPost,
  findApiPostByExternal,
  logAudit,
} from "./admin-data.js";
import { getIdempotent, saveIdempotent } from "./db.js";
import { serializePost } from "./api-serialize.js";
import { setSiteUrl } from "./config.js";

const nowMs = () => Date.now();

export class SecureOps extends DurableObject {
  async renderContent(input, format = "html") {
    const { renderMarkdown, sanitizeContent } = await import("./sanitize.js");
    return format === "markdown" ? renderMarkdown(input) : sanitizeContent(input);
  }

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)",
      );
    });
  }

  async ping() {
    return { ok: true, at: nowMs() };
  }

  async verifyScrypt(password, stored) {
    const started = performance.now();
    const { verifyScrypt } = await import("./auth.js");
    const ok = await verifyScrypt(password, stored);
    return { ok, ms: performance.now() - started };
  }

  async hashScrypt(password, params = {}) {
    const started = performance.now();
    const { hashScrypt } = await import("./auth.js");
    return { hash: await hashScrypt(password, params), ms: performance.now() - started };
  }

  async pbkdf2(password, iterations = 600000) {
    const started = performance.now();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(String(password)),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key,
      256,
    );
    return { ms: performance.now() - started, iterations };
  }

  async sanitize(input, format = "html") {
    const started = performance.now();
    const html = await this.renderContent(input, format);
    return { html, ms: performance.now() - started, bytes: new TextEncoder().encode(html).length };
  }

  async apiCreatePost(payload) {
    const db = this.env.DB;
    setSiteUrl(this.env.SITE_URL);
    const { clientId, clientPublishMode, data, idem } = payload;
    if (idem?.key) {
      const existing = await getIdempotent(db, clientId, idem.key, "POST", idem.path);
      if (existing) {
        if (existing.request_hash !== idem.requestHash) {
          return { status: 409, body: JSON.stringify({ error: { code: "idempotency_conflict", message: "Idempotency-Key đã được dùng với nội dung khác." } }) };
        }
        return { status: existing.status_code, body: existing.response_body, replay: true };
      }
    }
    if (data.externalId) {
      const existing = await findApiPostByExternal(db, clientId, data.externalId);
      if (existing) {
        if (existing.deleted_at) {
          return { status: 409, body: JSON.stringify({ error: { code: "external_id_conflict", message: "external_id đã thuộc bài đã xóa." } }) };
        }
        const body = { data: serializePost(existing), meta: { publish_mode: clientPublishMode, publish_demoted: false, external_id_replayed: true } };
        return { status: 200, body: JSON.stringify(body) };
      }
    }
    const html = await this.renderContent(data.contentSource || "", data.contentFormat || "html");
    const text = plainText(html);
    const excerpt = data.excerpt || text.slice(0, 180);
    let post;
    try {
      post = await createAdminPost(
        db,
        {
          ...data,
          excerpt,
          seoDescription: data.seoDescription || excerpt,
          contentHtml: html,
          origin: "api",
          apiClientId: clientId,
        },
        { actorType: "api", actorId: clientId },
        { includeTags: false },
      );
    } catch (error) {
      if (error.code === "MEDIA_NOT_READY") {
        return { status: 409, body: JSON.stringify({ error: { code: "media_not_ready", message: error.message, urls: error.urls || [] } }) };
      }
      throw error;
    }
    post.tags = (data.tags || []).map((name) => ({ name }));
    await logAudit(db, {
      actorType: "api",
      actorId: clientId,
      action: data.demoted ? "api.post_submitted" : "api.post_created",
      entityType: "post",
      entityId: post.id,
      meta: { slug: post.slug, status: post.status, demoted: data.demoted, external_id: data.externalId || null },
    });
    const body = { data: serializePost(post), meta: { publish_mode: clientPublishMode, publish_demoted: Boolean(data.demoted), ...(idem?.key ? { idempotency_key: idem.key } : {}) } };
    const serialized = JSON.stringify(body);
    if (idem?.key) {
      await saveIdempotent(db, clientId, idem.key, "POST", idem.path, idem.requestHash, 201, serialized);
    }
    return { status: 201, body: serialized };
  }

  async apiUpdatePost(payload) {
    const db = this.env.DB;
    setSiteUrl(this.env.SITE_URL);
    const { clientId, clientPublishMode, postId, patch, idem, expectedVersion = null } = payload;
    if (idem?.key) {
      const existing = await getIdempotent(db, clientId, idem.key, "PATCH", idem.path);
      if (existing) {
        if (existing.request_hash !== idem.requestHash) {
          return { status: 409, body: JSON.stringify({ error: { code: "idempotency_conflict", message: "Idempotency-Key đã được dùng với nội dung khác." } }) };
        }
        return { status: existing.status_code, body: existing.response_body, replay: true };
      }
    }
    const post = await getAdminPost(db, postId);
    if (!post) return { status: 404, body: JSON.stringify({ error: { code: "not_found", message: "Bài viết không tồn tại." } }) };
    if (post.deleted_at) return { status: 410, body: JSON.stringify({ error: { code: "gone", message: "Bài viết đã bị xóa." } }) };
    if (patch.contentSource !== undefined) {
      const format = patch.contentFormat || post.content_format;
      patch.contentHtml = await this.renderContent(patch.contentSource, format);
      patch.contentFormat = format;
    }
    let updated;
    try {
      updated = await updateAdminPost(db, post.id, patch, { actorType: "api", actorId: clientId }, { expectedVersion });
    } catch (error) {
      if (error.code === "VERSION_CONFLICT") {
        return { status: 412, body: JSON.stringify({ error: { code: "version_conflict", message: "Bài viết đã được cập nhật ở phiên bản khác.", current_version: error.currentVersion, details: [{ path: "If-Match", message: `Version hiện tại: ${error.currentVersion}` }] } }) };
      }
      if (error.code === "MEDIA_NOT_READY") {
        return { status: 409, body: JSON.stringify({ error: { code: "media_not_ready", message: error.message, urls: error.urls || [] } }) };
      }
      throw error;
    }
    await logAudit(db, {
      actorType: "api",
      actorId: clientId,
      action: "api.post_updated",
      entityType: "post",
      entityId: updated.id,
      meta: { slug: updated.slug, status: updated.status, fields: Object.keys(patch) },
    });
    const body = { data: serializePost(updated), meta: { publish_mode: clientPublishMode, publish_demoted: Boolean(patch.demoted), ...(idem?.key ? { idempotency_key: idem.key } : {}) } };
    const serialized = JSON.stringify(body);
    if (idem?.key) {
      await saveIdempotent(db, clientId, idem.key, "PATCH", idem.path, idem.requestHash, 200, serialized);
    }
    return { status: 200, body: serialized };
  }

  async rateLimit(key, max, windowMs) {
    const started = performance.now();
    const now = nowMs();
    const sql = this.ctx.storage.sql;
    const rows = sql
      .exec(
        "INSERT INTO rate (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate.window_start <= ? THEN 1 ELSE rate.count + 1 END, window_start = CASE WHEN rate.window_start <= ? THEN ? ELSE rate.window_start END RETURNING window_start, count",
        String(key),
        now,
        now - windowMs,
        now - windowMs,
        now,
      )
      .toArray();
    const row = rows[0] || { window_start: now, count: 1 };
    const reset = row.window_start + windowMs;
    return {
      allowed: row.count <= max,
      count: row.count,
      remaining: Math.max(0, max - row.count),
      reset,
      ms: performance.now() - started,
    };
  }

  async resetRate(key) {
    this.ctx.storage.sql.exec("DELETE FROM rate WHERE key = ?", String(key));
    return true;
  }
}
