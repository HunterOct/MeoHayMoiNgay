import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";

export function prepareEnv(prefix = "mh-test") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  process.env.NODE_ENV = "test";
  process.env.DB_PATH = path.join(dir, "test.db");
  process.env.UPLOAD_DIR = path.join(dir, "uploads");
  process.env.SITE_URL = "http://127.0.0.1:3000";
  process.env.LOG_LEVEL = "error";
  process.env.TRUST_PROXY = "0";
  return dir;
}

export async function startServer() {
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = server.address().port;
  return {
    server,
    base: `http://127.0.0.1:${port}`,
  };
}

export async function stopServer(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  const { closeDb } = await import("../src/db/index.js");
  closeDb();
}

export function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
}

export async function seedUser({ email, password, name = "Test User", role = "admin", bio = "" }) {
  const { hashPassword } = await import("../src/lib/passwords.js");
  const { insertUser } = await import("../src/db/users.js");
  return insertUser({
    email,
    passwordHash: await hashPassword(password),
    name,
    role,
    bio,
  });
}

export async function seedCategory({ name, slug, group = "life", description = "", sortOrder = 0 }) {
  const { createCategory } = await import("../src/db/taxonomy.js");
  return createCategory({ name, slug, group, description, sortOrder });
}

export async function seedPost({
  title,
  slug,
  authorId,
  categoryId = null,
  status = "published",
  content = "<p>Nội dung kiểm thử đủ dài để hiển thị và lập chỉ mục.</p>",
  excerpt = "Mô tả ngắn cho bài kiểm thử.",
  coverImage = "/assets/img/img-001.jpg",
  publishedAt = null,
  scheduledAt = null,
  tags = [],
}) {
  const { createPost } = await import("../src/db/posts.js");
  return createPost(
    {
      title,
      slug,
      excerpt,
      lede: "Đoạn mở đầu kiểm thử.",
      contentHtml: content,
      contentSource: content,
      contentFormat: "html",
      status,
      authorId,
      categoryId,
      coverImage,
      coverAlt: "Ảnh kiểm thử",
      coverCaption: "Chú thích ảnh",
      seoTitle: "",
      seoDescription: excerpt,
      publishedAt,
      scheduledAt,
      tags,
      origin: "test",
    },
    { actorType: "system", actorId: null },
  );
}

export async function getDb() {
  const module = await import("../src/db/index.js");
  return module.getDb();
}

export function makeClient(base, { defaultUA = BROWSER_UA } = {}) {
  const jar = new Map();

  async function request(pathname, options = {}) {
    const {
      method = "GET",
      json,
      form,
      multipart,
      headers = {},
      ua = defaultUA,
      redirect = "manual",
    } = options;

    const finalHeaders = { ...headers };
    if (ua) finalHeaders["user-agent"] = ua;
    if (jar.size) {
      finalHeaders.cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    let body;
    if (multipart) {
      body = multipart;
    } else if (form) {
      finalHeaders["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(Array.isArray(form) ? form : Object.entries(form)).toString();
    } else if (json !== undefined) {
      finalHeaders["content-type"] = "application/json";
      body = JSON.stringify(json);
    }

    const response = await fetch(base + pathname, {
      method,
      headers: finalHeaders,
      body,
      redirect,
    });

    const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (index < 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value || /max-age=0/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }

    const text = await response.text();
    let data = null;
    if ((response.headers.get("content-type") || "").includes("application/json")) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      location: response.headers.get("location"),
      text,
      json: data,
      setCookies,
    };
  }

  return { request, jar };
}

export function csrfFrom(html) {
  const match = /name="_csrf" value="([^"]+)"/.exec(html || "");
  return match ? match[1] : "";
}

export async function login(client, email, password) {
  const page = await client.request("/admin/login");
  const csrf = csrfFrom(page.text);
  const result = await client.request("/admin/login", {
    method: "POST",
    form: { _csrf: csrf, email, password },
  });
  return { page, result };
}

export function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
