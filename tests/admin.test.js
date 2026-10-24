import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  prepareEnv,
  startServer,
  stopServer,
  cleanupDir,
  seedUser,
  seedCategory,
  seedPost,
  makeClient,
  login,
  csrfFrom,
  getDb,
  PNG_1PX,
} from "./support.js";

const dir = prepareEnv("mh-admin");
const ctx = await startServer();

const adminUser = await seedUser({
  email: "admin@test.local",
  password: "AdminPass12345",
  name: "Quản trị",
  role: "admin",
});
const editorUser = await seedUser({
  email: "editor@test.local",
  password: "EditorPass12345",
  name: "Biên tập",
  role: "editor",
});
const authorUser = await seedUser({
  email: "author@test.local",
  password: "AuthorPass12345",
  name: "Tác giả",
  role: "author",
});
const category = await seedCategory({ name: "Mẹo vặt", slug: "meo-vat", group: "life" });
const adminPost = await seedPost({
  title: "Bài do quản trị đăng",
  slug: "bai-quan-tri",
  authorId: adminUser.id,
  categoryId: category.id,
  status: "published",
  publishedAt: "2026-10-10T01:00:00.000Z",
});

const adminClient = makeClient(ctx.base);
const editorClient = makeClient(ctx.base);
const authorClient = makeClient(ctx.base);

after(async () => {
  await stopServer(ctx);
  cleanupDir(dir);
});

async function adminCsrf(client) {
  const page = await client.request("/admin/posts/new");
  assert.equal(page.status, 200);
  return csrfFrom(page.text);
}

test("login succeeds and dashboard renders", async () => {
  const { result } = await login(adminClient, "admin@test.local", "AdminPass12345");
  assert.equal(result.status, 302);
  assert.equal(result.location, "/admin");
  const dashboard = await adminClient.request("/admin");
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Xin chào, Quản trị/);
  assert.match(dashboard.text, /Bài do quản trị đăng/);
});

test("POST without CSRF token is rejected", async () => {
  const res = await adminClient.request("/admin/posts", {
    method: "POST",
    form: { title: "Không có csrf", content: "Nội dung" },
  });
  assert.equal(res.status, 403);
  const db = await getDb();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE title = ?").get("Không có csrf").n, 0);
});

test("admin can create and publish a post via the CMS", async () => {
  const csrf = await adminCsrf(adminClient);
  const res = await adminClient.request("/admin/posts", {
    method: "POST",
    form: {
      _csrf: csrf,
      title: "Bài tạo từ CMS",
      slug: "bai-tao-tu-cms",
      excerpt: "Mô tả CMS.",
      lede: "Mở đầu CMS.",
      content: "## Mục\n\nNội dung **đậm** và <script>alert(1)</script>.",
      content_format: "markdown",
      category_id: category.id,
      tags: "cms, kiểm thử",
      cover_image: "/assets/img/img-002.jpg",
      cover_alt: "Ảnh CMS",
      seo_title: "SEO CMS",
      seo_description: "Mô tả SEO CMS.",
      action: "publish",
    },
  });
  assert.equal(res.status, 302);
  assert.match(res.location, /^\/admin\/posts\/[0-9a-f-]+\/edit\?msg=published$/);

  const db = await getDb();
  const post = db.prepare("SELECT * FROM posts WHERE slug = 'bai-tao-tu-cms'").get();
  assert.ok(post);
  assert.equal(post.status, "published");
  assert.equal(/<script/i.test(post.content_html), false);
  assert.match(post.content_html, /<strong>đậm<\/strong>/);

  const publicPage = await adminClient.request("/bai-viet/bai-tao-tu-cms");
  assert.equal(publicPage.status, 200);
});

test("updating a post creates a revision snapshot", async () => {
  const db = await getDb();
  const post = db.prepare("SELECT * FROM posts WHERE slug = 'bai-tao-tu-cms'").get();
  const csrf = csrfFrom((await adminClient.request(`/admin/posts/${post.id}/edit`)).text);
  const res = await adminClient.request(`/admin/posts/${post.id}`, {
    method: "POST",
    form: {
      _csrf: csrf,
      title: "Bài tạo từ CMS (sửa)",
      slug: post.slug,
      excerpt: "Mô tả đã sửa.",
      lede: post.lede,
      content: "## Mục mới\n\nNội dung đã cập nhật.",
      content_format: "markdown",
      category_id: category.id,
      cover_image: post.cover_image,
      action: "save",
    },
  });
  assert.equal(res.status, 302);
  const updated = db.prepare("SELECT * FROM posts WHERE id = ?").get(post.id);
  assert.equal(updated.title, "Bài tạo từ CMS (sửa)");
  const revisions = db.prepare("SELECT COUNT(*) AS n FROM revisions WHERE post_id = ?").get(post.id).n;
  assert.ok(revisions >= 2, String(revisions));
});

test("trash, 410 and restore flow", async () => {
  const db = await getDb();
  const post = db.prepare("SELECT * FROM posts WHERE slug = 'bai-tao-tu-cms'").get();
  const csrf = csrfFrom((await adminClient.request(`/admin/posts/${post.id}/edit`)).text);
  let res = await adminClient.request(`/admin/posts/${post.id}/delete`, {
    method: "POST",
    form: { _csrf: csrf },
  });
  assert.equal(res.status, 302);
  assert.equal((await adminClient.request("/bai-viet/bai-tao-tu-cms")).status, 410);

  res = await adminClient.request(`/admin/posts/${post.id}/restore`, {
    method: "POST",
    form: { _csrf: csrf },
  });
  assert.equal(res.status, 302);
  assert.equal((await adminClient.request("/bai-viet/bai-tao-tu-cms")).status, 200);
});

test("author is restricted to their own drafts and cannot publish", async () => {
  await login(authorClient, "author@test.local", "AuthorPass12345");
  const csrf = await adminCsrf(authorClient);
  const created = await authorClient.request("/admin/posts", {
    method: "POST",
    form: {
      _csrf: csrf,
      title: "Bài của tác giả",
      content: "Nội dung bài tác giả viết đủ dài để gửi duyệt.",
      content_format: "markdown",
      category_id: category.id,
      action: "review",
    },
  });
  assert.equal(created.status, 302);
  assert.match(created.location, /msg=submitted/);
  const authorPostId = /\/admin\/posts\/([0-9a-f-]+)\/edit/.exec(created.location)[1];

  const list = await authorClient.request("/admin/posts");
  assert.equal(list.status, 200);
  assert.doesNotMatch(list.text, /Bài do quản trị đăng/);

  assert.equal((await authorClient.request(`/admin/posts/${adminPost.id}/edit`)).status, 403);
  assert.equal((await authorClient.request("/admin/users")).status, 403);

  const csrf2 = csrfFrom((await authorClient.request(`/admin/posts/${authorPostId}/edit`)).text);
  const publishAttempt = await authorClient.request(`/admin/posts/${authorPostId}`, {
    method: "POST",
    form: {
      _csrf: csrf2,
      title: "Bài của tác giả",
      content: "Nội dung bài tác giả viết đủ dài để gửi duyệt.",
      content_format: "markdown",
      category_id: category.id,
      action: "publish",
    },
  });
  assert.equal(publishAttempt.status, 403);
});

test("editor can review and publish an author submission", async () => {
  await login(editorClient, "editor@test.local", "EditorPass12345");
  const db = await getDb();
  const post = db.prepare("SELECT * FROM posts WHERE title = 'Bài của tác giả'").get();
  const editPage = await editorClient.request(`/admin/posts/${post.id}/edit`);
  assert.equal(editPage.status, 200);
  const csrf = csrfFrom(editPage.text);
  const res = await editorClient.request(`/admin/posts/${post.id}`, {
    method: "POST",
    form: {
      _csrf: csrf,
      title: post.title,
      content: post.content_source,
      content_format: post.content_format,
      category_id: post.category_id,
      action: "publish",
    },
  });
  assert.equal(res.status, 302);
  const updated = db.prepare("SELECT status FROM posts WHERE id = ?").get(post.id);
  assert.equal(updated.status, "published");
});

test("media upload, listing and deletion", async () => {
  const csrf = csrfFrom((await adminClient.request("/admin/media")).text);
  const form = new FormData();
  form.append("_csrf", csrf);
  form.append("file", new Blob([PNG_1PX], { type: "image/png" }), "pixel.png");
  form.append("alt", "Ảnh pixel");
  const res = await adminClient.request("/admin/media", { method: "POST", multipart: form });
  assert.equal(res.status, 302);

  const db = await getDb();
  const media = db.prepare("SELECT * FROM media WHERE original_name = 'pixel.png'").get();
  assert.ok(media);
  assert.equal(media.width, 1);
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, media.filename)));

  const mediaPage = await adminClient.request("/admin/media");
  assert.match(mediaPage.text, /Ảnh pixel/);

  const delCsrf = csrfFrom(mediaPage.text);
  const del = await adminClient.request(`/admin/media/${media.id}/delete`, {
    method: "POST",
    form: { _csrf: delCsrf },
  });
  assert.equal(del.status, 302);
  assert.equal(fs.existsSync(path.join(process.env.UPLOAD_DIR, media.filename)), false);
});

test("bulk publish applies to selected posts", async () => {
  const db = await getDb();
  const first = await seedPost({
    title: "Bulk một",
    slug: "bulk-mot",
    authorId: adminUser.id,
    categoryId: category.id,
    status: "draft",
  });
  const second = await seedPost({
    title: "Bulk hai",
    slug: "bulk-hai",
    authorId: adminUser.id,
    categoryId: category.id,
    status: "draft",
  });
  const csrf = csrfFrom((await adminClient.request("/admin/posts")).text);
  const res = await adminClient.request("/admin/posts/bulk", {
    method: "POST",
    form: [
      ["_csrf", csrf],
      ["bulk_action", "publish"],
      ["ids", first.id],
      ["ids", second.id],
      ["return_to", "/admin/posts"],
    ],
  });
  assert.equal(res.status, 302);
  assert.equal(db.prepare("SELECT status FROM posts WHERE id = ?").get(first.id).status, "published");
  assert.equal(db.prepare("SELECT status FROM posts WHERE id = ?").get(second.id).status, "published");
});

test("category and tag management enforces usage and CRUD", async () => {
  const db = await getDb();
  let csrf = csrfFrom((await adminClient.request("/admin/categories")).text);
  let res = await adminClient.request("/admin/categories", {
    method: "POST",
    form: { _csrf: csrf, name: "Chuyên mục mới", group: "life", sort_order: "99" },
  });
  assert.equal(res.status, 302);
  const created = db.prepare("SELECT * FROM categories WHERE name = 'Chuyên mục mới'").get();
  assert.ok(created);

  const delCsrf = csrfFrom((await adminClient.request("/admin/categories")).text);
  res = await adminClient.request(`/admin/categories/${created.id}/delete`, {
    method: "POST",
    form: { _csrf: delCsrf, reassign_to: "" },
  });
  assert.equal(res.status, 302);
  assert.equal(db.prepare("SELECT id FROM categories WHERE id = ?").get(created.id), undefined);

  const usedDelete = await adminClient.request(`/admin/categories/${category.id}/delete`, {
    method: "POST",
    form: { _csrf: delCsrf, reassign_to: "" },
  });
  assert.match(usedDelete.location, /err=category_in_use/);

  csrf = csrfFrom((await adminClient.request("/admin/tags")).text);
  res = await adminClient.request("/admin/tags", {
    method: "POST",
    form: { _csrf: csrf, name: "thẻ kiểm thử" },
  });
  assert.equal(res.status, 302);
  const tag = db.prepare("SELECT * FROM tags WHERE name = 'thẻ kiểm thử'").get();
  assert.ok(tag);
  res = await adminClient.request(`/admin/tags/${tag.id}/delete`, {
    method: "POST",
    form: { _csrf: csrf },
  });
  assert.equal(res.status, 302);
  assert.equal(db.prepare("SELECT id FROM tags WHERE id = ?").get(tag.id), undefined);
});

test("user management validates passwords and protects the current admin", async () => {
  const db = await getDb();
  const csrf = csrfFrom((await adminClient.request("/admin/users")).text);
  let res = await adminClient.request("/admin/users", {
    method: "POST",
    form: {
      _csrf: csrf,
      name: "Biên tập mới",
      email: "new.editor@test.local",
      role: "editor",
      password: "MatKhau12345",
    },
  });
  assert.equal(res.status, 302);
  const created = db.prepare("SELECT * FROM users WHERE email = 'new.editor@test.local'").get();
  assert.ok(created);
  assert.equal(created.role, "editor");

  res = await adminClient.request("/admin/users", {
    method: "POST",
    form: {
      _csrf: csrf,
      name: "Yếu",
      email: "weak@test.local",
      role: "author",
      password: "123",
    },
  });
  assert.match(res.location, /err=password_weak/);

  res = await adminClient.request(`/admin/users/${adminUser.id}`, {
    method: "POST",
    form: {
      _csrf: csrf,
      name: "Quản trị",
      email: "admin@test.local",
      role: "admin",
      is_active: "0",
    },
  });
  assert.match(res.location, /err=admin_self/);
  assert.equal(db.prepare("SELECT is_active FROM users WHERE id = ?").get(adminUser.id).is_active, 1);
});

test("admin can create an API client and the key authenticates", async () => {
  const csrf = csrfFrom((await adminClient.request("/admin/api-clients")).text);
  const res = await adminClient.request("/admin/api-clients", {
    method: "POST",
    form: [
      ["_csrf", csrf],
      ["name", "Client từ admin"],
      ["scopes", "posts:read"],
      ["scopes", "posts:write"],
      ["publish_mode", "review"],
      ["rate_limit_per_min", "60"],
    ],
  });
  assert.equal(res.status, 200);
  const match = /<code id="newApiKey">([^<]+)<\/code>/.exec(res.text);
  assert.ok(match, "API key reveal missing");
  const me = await makeClient(ctx.base).request("/api/v1/me", {
    headers: { authorization: `Bearer ${match[1]}` },
  });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.name, "Client từ admin");
});

test("logout invalidates the session", async () => {
  const page = await adminClient.request("/admin");
  const csrf = csrfFrom(page.text);
  const res = await adminClient.request("/admin/logout", { method: "POST", form: { _csrf: csrf } });
  assert.equal(res.status, 302);
  const dashboard = await adminClient.request("/admin");
  assert.equal(dashboard.status, 302);
  assert.match(dashboard.location, /\/admin\/login/);
});
