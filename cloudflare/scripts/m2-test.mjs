import fs from "node:fs";
import { spawnSync } from "node:child_process";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
const stagingToken = fs.readFileSync(".staging-token", "utf8").trim();
const stamp = Date.now().toString(36);
const P = `m2qa-${stamp}`;
const results = [];
const cleanup = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

class Jar {
  cookie = "";
  update(response) {
    const values = response.headers.getSetCookie?.() || [];
    const map = new Map(this.cookie.split("; ").filter(Boolean).map((item) => [item.split("=")[0], item]));
    for (const raw of values) {
      const pair = raw.split(";")[0];
      const key = pair.split("=")[0];
      if (pair.endsWith("=")) map.delete(key);
      else map.set(key, pair);
    }
    this.cookie = [...map.values()].join("; ");
    return values;
  }
}

async function request(jar, path, options = {}) {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141 M2-Test",
    ...(jar ? { cookie: jar.cookie } : {}),
    ...(options.headers || {}),
  };
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(BASE + path, {
        ...options,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (jar) jar.update(response);
      return { response, text: await response.text() };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function csrfFrom(text) {
  return /name="_csrf" value="([^"]+)"/.exec(text)?.[1] || "";
}

async function login(role, jar = new Jar()) {
  const page = await request(jar, "/admin/login");
  const csrf = csrfFrom(page.text);
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await request(jar, "/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: csrf, email: creds[role].email, password: creds[role].password }),
    });
    if (response.response.status !== 0) break;
  }
  return { jar, csrf, ...response };
}

async function adminPage(jar, path) {
  const page = await request(jar, path);
  if (page.response.status === 200) jar.csrf = csrfFrom(page.text);
  return page;
}

async function form(jar, path, fields, tokenPath = "/admin") {
  const page = await adminPage(jar, tokenPath);
  const csrf = csrfFrom(page.text);
  const version = fields.version ?? versionFrom(page.text, path);
  const response = await request(jar, path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, ...(version ? { version } : {}), ...fields }),
  });
  jar.csrf = csrf;
  return response;
}

function versionFrom(text, path) {
  const match = /\/admin\/posts\/([^/]+)\/(?:delete|restore|purge)$/.exec(path);
  if (!match) return null;
  const id = match[1];
  const start = Math.max(
    text.indexOf(`action="/admin/posts/${id}/delete"`),
    text.indexOf(`action="/admin/posts/${id}/restore"`),
    text.indexOf(`action="/admin/posts/${id}/purge"`),
  );
  if (start < 0) return null;
  return /name="version" value="(\d+)"/.exec(text.slice(start, start + 500))?.[1] || null;
}

function d1(sql) {
  const file = `fixtures/.${P}.sql`;
  fs.writeFileSync(file, sql);
  const result = spawnSync(
    "npx.cmd",
    [
      "wrangler", "d1", "execute", "meohay-m0-stg-230403", "--remote",
      "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--file", file,
    ],
    { encoding: "utf8", shell: true },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function d1Json(sql) {
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "meohay-m0-stg-230403", "--remote",
      "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler", "--command", sql, "--json",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const start = result.stdout.indexOf("[");
  return JSON.parse(result.stdout.slice(start));
}

async function publicPage(path) {
  return request(null, path);
}

function idFromLocation(location) {
  return /\/admin\/posts\/([^/]+)\//.exec(location || "")?.[1] || null;
}

// ---------------- auth ----------------
await fetch(`${BASE}/api/m0/bench/reset-rate`, {
  method: "POST",
  headers: { "x-staging-token": stagingToken, "content-type": "application/json" },
  body: "{}",
});
const anon = await request(null, "/admin");
check("unauthenticated admin redirects", anon.response.status === 302 && anon.response.headers.get("location")?.startsWith("/admin/login?next="));

const loginJar = new Jar();
const loginGet = await request(loginJar, "/admin/login");
check("login page renders", loginGet.response.status === 200 && loginGet.text.includes("Đăng nhập quản trị"));
const loginCsrf = csrfFrom(loginGet.text);
const badCsrf = await request(loginJar, "/admin/login", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: "wrong", email: creds.admin.email, password: creds.admin.password }),
});
check("login rejects bad CSRF", badCsrf.response.status === 403);
const badPassword = await request(loginJar, "/admin/login", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: loginCsrf, email: creds.admin.email, password: "WrongPassword-123" }),
});
check("login rejects bad password", badPassword.response.status === 200 && badPassword.text.includes("Email hoặc mật khẩu không đúng."));
const adminLogin = await login("admin");
const adminJar = adminLogin.jar;
const loginCookies = adminLogin.response.headers.getSetCookie?.() || [];
const sessionCookie = loginCookies.find((item) => item.startsWith("mh_session=")) || "";
check("admin login redirects", adminLogin.response.status === 302 && adminLogin.response.headers.get("location") === "/admin");
check("session cookie flags", /HttpOnly/i.test(sessionCookie) && /Secure/i.test(sessionCookie) && /SameSite=Lax/i.test(sessionCookie), sessionCookie);
const dashboard = await adminPage(adminJar, "/admin");
check("dashboard renders", dashboard.response.status === 200 && dashboard.text.includes("Xin chào"));
const noCsrf = await request(adminJar, "/admin/posts/bulk/apply", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ bulk_action: "trash" }),
});
check("admin mutation rejects missing CSRF", noCsrf.response.status === 403);
const crossOrigin = await request(adminJar, "/admin/logout", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
  body: new URLSearchParams({ _csrf: adminJar.csrf }),
});
check("admin mutation rejects cross-origin", crossOrigin.response.status === 403);
const badSessionJar = new Jar();
badSessionJar.cookie = "mh_session=invalid-session-token";
const badSession = await request(badSessionJar, "/admin");
check("invalid session redirects to login", badSession.response.status === 302 && badSession.response.headers.get("location")?.startsWith("/admin/login"));

// ---------------- posts CRUD ----------------
const slug = `${P}-post`;
const newPage = await adminPage(adminJar, "/admin/posts/new");
check("post editor renders", newPage.response.status === 200 && newPage.text.includes("Nội dung"));
const editorCsrf = csrfFrom(newPage.text);
const create = await request(adminJar, "/admin/posts", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    _csrf: editorCsrf,
    title: `M2 QA ${stamp}`,
    slug,
    excerpt: "M2 QA excerpt",
    lede: "M2 QA lede",
    content: `# M2 QA\n\nNoi dung kiểm thử ${stamp}.\n\n<script>window.__xss=1</script>`,
    content_format: "markdown",
    category_id: "60a889c5-cde8-4a80-9d22-01728dbbd5ad",
    author_id: "user-m0-admin",
    cover_image: "/assets/img/img-001.jpg",
    tags: `m2tag-${stamp}`,
    action: "save",
  }),
});
const postId = idFromLocation(create.response.headers.get("location"));
check("create draft", create.response.status === 302 && Boolean(postId), create.response.headers.get("location") || "");
if (postId) cleanup.push(postId);
const publicDraft = await publicPage(`/bai-viet/${slug}`);
check("draft hidden publicly", publicDraft.response.status === 404);
const listPage = await adminPage(adminJar, "/admin/posts");
check("draft visible in admin list", listPage.text.includes(`M2 QA ${stamp}`));
const preview = await adminPage(adminJar, `/admin/posts/${postId}/preview`);
check("preview renders noindex", preview.response.status === 200 && preview.text.includes("noindex") && preview.text.includes("Đang xem trước"));
check("preview sanitizes script", !preview.text.includes("<script>window.__xss"));
const publish = await form(adminJar, `/admin/posts/${postId}`, {
  title: `M2 QA ${stamp}`,
  slug,
  excerpt: "M2 QA excerpt",
  lede: "M2 QA lede",
  content: `# M2 QA\n\nNoi dung kiểm thử ${stamp}.\n\n<script>window.__xss=1</script>`,
  content_format: "markdown",
  category_id: "60a889c5-cde8-4a80-9d22-01728dbbd5ad",
  author_id: "user-m0-admin",
  cover_image: "/assets/img/img-001.jpg",
  tags: `m2tag-${stamp}`,
  action: "publish",
}, `/admin/posts/${postId}/edit`);
check("publish post", publish.response.status === 302);
const publicPost = await publicPage(`/bai-viet/${slug}`);
check("published post renders", publicPost.response.status === 200 && publicPost.text.includes(`M2 QA ${stamp}`));
check("public post sanitizes script", !publicPost.text.includes("<script>window.__xss"));
const updateTitle = `M2 QA ${stamp} updated`;
const update = await form(adminJar, `/admin/posts/${postId}`, {
  title: updateTitle,
  slug,
  excerpt: "M2 QA excerpt",
  content: `# M2 QA\n\nNoi dung kiểm thử ${stamp}.\n\n<script>window.__xss=1</script>`,
  content_format: "markdown",
  category_id: "60a889c5-cde8-4a80-9d22-01728dbbd5ad",
  author_id: "user-m0-admin",
  cover_image: "/assets/img/img-001.jpg",
  tags: `m2tag-${stamp}`,
  action: "save",
}, `/admin/posts/${postId}/edit`);
check("update post", update.response.status === 302);
const publicUpdated = await publicPage(`/bai-viet/${slug}`);
check("update reflected publicly", publicUpdated.text.includes("updated"));
const newSlug = `${P}-renamed`;
const rename = await form(adminJar, `/admin/posts/${postId}`, {
  title: updateTitle,
  slug: newSlug,
  excerpt: "M2 QA excerpt",
  content: `# M2 QA\n\nNoi dung kiểm thử ${stamp}.`,
  content_format: "markdown",
  category_id: "60a889c5-cde8-4a80-9d22-01728dbbd5ad",
  author_id: "user-m0-admin",
  cover_image: "/assets/img/img-001.jpg",
  tags: `m2tag-${stamp}`,
  action: "save",
}, `/admin/posts/${postId}/edit`);
check("change slug", rename.response.status === 302);
const oldSlug = await publicPage(`/bai-viet/${slug}`);
const newSlugPage = await publicPage(`/bai-viet/${newSlug}`);
check("old slug 301", oldSlug.response.status === 301 && oldSlug.response.headers.get("location") === `/bai-viet/${newSlug}`);
check("new slug public", newSlugPage.response.status === 200);
const revisions = await adminPage(adminJar, `/admin/posts/${postId}/revisions`);
check("revisions render", revisions.response.status === 200 && revisions.text.includes("Lịch sử chỉnh sửa"));
const revisionId = /\/admin\/posts\/[^/]+\/revisions\/([^/"]+)\/restore/.exec(revisions.text)?.[1];
check("revision exists", Boolean(revisionId), revisionId || "");
if (revisionId) {
  const restore = await form(adminJar, `/admin/posts/${postId}/revisions/${revisionId}/restore`, {}, `/admin/posts/${postId}/revisions`);
  check("restore revision", restore.response.status === 302);
}
const unpublish = await form(adminJar, `/admin/posts/${postId}`, {
  title: updateTitle,
  slug: newSlug,
  excerpt: "M2 QA excerpt",
  content: "# M2 QA\n\nNoi dung kiểm thử.",
  content_format: "markdown",
  category_id: "60a889c5-cde8-4a80-9d22-01728dbbd5ad",
  author_id: "user-m0-admin",
  cover_image: "/assets/img/img-001.jpg",
  tags: `m2tag-${stamp}`,
  action: "draft",
}, `/admin/posts/${postId}/edit`);
check("unpublish", unpublish.response.status === 302);
check("unpublished public 404", (await publicPage(`/bai-viet/${newSlug}`)).response.status === 404);
check("unpublished hidden home", !(await publicPage("/")).text.includes(newSlug));

// ---------------- scheduled ----------------
const scheduledSlug = `${P}-scheduled`;
const schedule = await request(adminJar, "/admin/posts", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    _csrf: csrfFrom((await adminPage(adminJar, "/admin/posts/new")).text),
    title: `M2 QA scheduled ${stamp}`,
    slug: scheduledSlug,
    excerpt: "scheduled",
    content: "# Scheduled\n\nNoi dung scheduled test.",
    content_format: "markdown",
    category_id: "60a889c5-cde8-4a80-9d22-01728dbbd5ad",
    author_id: "user-m0-admin",
    tags: `m2tag-${stamp}`,
    action: "schedule",
    scheduled_at_input: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16),
  }),
});
const scheduledId = idFromLocation(schedule.response.headers.get("location"));
if (scheduledId) cleanup.push(scheduledId);
check("schedule post", schedule.response.status === 302 && Boolean(scheduledId));
check("scheduled hidden", (await publicPage(`/bai-viet/${scheduledSlug}`)).response.status === 404);
if (scheduledId) {
  d1(`UPDATE posts SET scheduled_at='${new Date(Date.now() - 60_000).toISOString()}' WHERE id='${scheduledId}';`);
  const cron = await request(null, "/api/m0/cron/run", { method: "POST", headers: { "x-staging-token": stagingToken } });
  check("cron publishes admin scheduled post", cron.response.status === 200 && (await publicPage(`/bai-viet/${scheduledSlug}`)).response.status === 200);
}

// ---------------- delete/restore/purge ----------------
const deleteResponse = await form(adminJar, `/admin/posts/${postId}/delete`, { return_to: "/admin/posts" }, `/admin/posts/${postId}/edit`);
check("soft delete", deleteResponse.response.status === 302);
check("deleted public 410", (await publicPage(`/bai-viet/${newSlug}`)).response.status === 410);
const trashPage = await adminPage(adminJar, "/admin/trash");
check("trash lists post", trashPage.text.includes(updateTitle));
const restoreResponse = await form(adminJar, `/admin/posts/${postId}/restore`, {}, `/admin/trash`);
check("restore post", restoreResponse.response.status === 302);
const purgeResponse = await form(adminJar, `/admin/posts/${postId}/delete`, { return_to: "/admin/posts" }, `/admin/posts/${postId}/edit`);
check("delete again", purgeResponse.response.status === 302);
const purge = await form(adminJar, `/admin/posts/${postId}/purge`, {}, `/admin/trash`);
check("purge post", purge.response.status === 302);
const purgeCheck = await publicPage(`/bai-viet/${newSlug}`);
check("purged post gone", purgeCheck.response.status === 404);

// ---------------- RBAC / IDOR ----------------
const editor = await login("editor");
const editorUsers = await request(editor.jar, "/admin/users");
check("editor cannot manage users", editorUsers.response.status === 403);
const editorSettings = await request(editor.jar, "/admin/settings");
check("editor cannot manage settings", editorSettings.response.status === 403);
const editorCats = await request(editor.jar, "/admin/categories");
check("editor can manage taxonomy", editorCats.response.status === 200);

const author = await login("author");
const authorUsers = await request(author.jar, "/admin/users");
check("author cannot manage users", authorUsers.response.status === 403);
const authorCats = await request(author.jar, "/admin/categories");
check("author cannot manage taxonomy", authorCats.response.status === 403);
const authorNew = await adminPage(author.jar, "/admin/posts/new");
const authorCsrf = csrfFrom(authorNew.text);
const authorCreate = await request(author.jar, "/admin/posts", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    _csrf: authorCsrf,
    title: `M2 QA author ${stamp}`,
    slug: `${P}-author`,
    excerpt: "author draft",
    content: "# Author draft\n\nNoi dung author.",
    content_format: "markdown",
    category_id: "",
    author_id: "user-m0-admin",
    tags: "",
    action: "save",
  }),
});
const authorPostId = idFromLocation(authorCreate.response.headers.get("location"));
if (authorPostId) cleanup.push(authorPostId);
check("author can create own draft", authorCreate.response.status === 302 && Boolean(authorPostId));
const authorPublish = await form(author.jar, `/admin/posts/${authorPostId}`, {
  title: `M2 QA author ${stamp}`,
  slug: `${P}-author`,
  excerpt: "author draft",
  content: "# Author draft\n\nNoi dung author.",
  content_format: "markdown",
  category_id: "",
  author_id: "user-m0-author",
  tags: "",
  action: "publish",
}, `/admin/posts/${authorPostId}/edit`);
check("author cannot publish", authorPublish.response.status === 403);
const authorEditAdmin = await request(author.jar, `/admin/posts/${scheduledId}/edit`);
check("author cannot edit other's post (IDOR)", authorEditAdmin.response.status === 403);
const authorReview = await form(author.jar, `/admin/posts/${authorPostId}`, {
  title: `M2 QA author ${stamp}`,
  slug: `${P}-author`,
  excerpt: "author draft",
  content: "# Author draft\n\nNoi dung author.",
  content_format: "markdown",
  category_id: "",
  author_id: "user-m0-author",
  tags: "",
  action: "review",
}, `/admin/posts/${authorPostId}/edit`);
check("author can submit review", authorReview.response.status === 302);
const editorPublish = await form(editor.jar, `/admin/posts/${authorPostId}`, {
  title: `M2 QA author ${stamp}`,
  slug: `${P}-author`,
  excerpt: "author draft",
  content: "# Author draft\n\nNoi dung author.",
  content_format: "markdown",
  category_id: "",
  author_id: "user-m0-author",
  tags: "",
  action: "publish",
}, `/admin/posts/${authorPostId}/edit`);
check("editor can publish author post", editorPublish.response.status === 302);
const authorEditPublished = await request(author.jar, `/admin/posts/${authorPostId}/edit`);
check("author cannot edit published own post", authorEditPublished.response.status === 403);

// ---------------- taxonomy ----------------
const catName = `M2QA ${stamp}`;
const catCreate = await form(adminJar, "/admin/categories", { name: catName, slug: `${P}-cat`, group: "tech", description: "QA category", sort_order: "99" }, "/admin/categories");
check("create category", catCreate.response.status === 302);
const cat = await publicPage(`/chuyen-muc/${P}-cat`);
check("category public", cat.response.status === 200);
const catId = d1Json(`SELECT id FROM categories WHERE slug='${P}-cat';`)[0]?.results?.[0]?.id || "";
check("category created in D1", Boolean(catId), catId || "");
if (catId) {
  const catUpdate2 = await form(adminJar, `/admin/categories/${catId}`, { name: `${catName} updated`, slug: `${P}-cat`, group: "tech", description: "QA category updated", sort_order: "99" }, "/admin/categories");
  check("update category", catUpdate2.response.status === 302);
  const catDelete = await form(adminJar, `/admin/categories/${catId}/delete`, { reassign_to: "" }, "/admin/categories");
  check("delete unused category", catDelete.response.status === 302);
}
const tagName = `m2qa-tag-${stamp}`;
const tagCreate = await form(adminJar, "/admin/tags", { name: tagName, slug: `${P}-tag` }, "/admin/tags");
check("create tag", tagCreate.response.status === 302);
const tagPublic = await publicPage(`/the/${P}-tag`);
check("tag public", tagPublic.response.status === 200);
const tagId = d1Json(`SELECT id FROM tags WHERE slug='${P}-tag';`)[0]?.results?.[0]?.id || "";
if (tagId) {
  const tagDelete = await form(adminJar, `/admin/tags/${tagId}/delete`, {}, "/admin/tags");
  check("delete tag", tagDelete.response.status === 302);
}

// ---------------- users ----------------
const testEmail = `${P}-user@test.local`;
const testPassword = `M2QA-${stamp}-Pass1`;
const userCreate = await form(adminJar, "/admin/users", { name: "M2 QA User", email: testEmail, role: "author", password: testPassword }, "/admin/users");
check("create user", userCreate.response.status === 302, `${userCreate.response.status} ${userCreate.response.headers.get("location") || ""}`);
const testUserJar = new Jar();
const testLogin = await loginWith(testEmail, testPassword, testUserJar);
check("new user can login", testLogin.response.status === 302, `${testLogin.response.status} ${testLogin.response.headers.get("location") || ""}`);
const testUserId = d1Json(`SELECT id FROM users WHERE email='${testEmail}';`)[0]?.results?.[0]?.id || "";
check("test user id appears", Boolean(testUserId), testUserId);
if (testUserId) {
  const userDisable = await form(adminJar, `/admin/users/${testUserId}`, { name: "M2 QA User", email: testEmail, role: "author", is_active: "" }, "/admin/users");
  check("disable user", userDisable.response.status === 302);
  const disabledLogin = await loginWith(testEmail, testPassword, new Jar());
  check("disabled user cannot login", disabledLogin.response.status === 200 && disabledLogin.text.includes("Email hoặc mật khẩu không đúng."));
}

// ---------------- API clients ----------------
const clientName = `M2QA client ${stamp}`;
const clientPage = await adminPage(adminJar, "/admin/api-clients");
const clientCreate = await request(adminJar, "/admin/api-clients", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: csrfFrom(clientPage.text), name: clientName, "scopes": "posts:read", publish_mode: "review", rate_limit_per_min: "60" }),
});
const apiKey = /<code id="newApiKey">([^<]+)<\/code>/.exec(clientCreate.text)?.[1] || "";
check("create API client", clientCreate.response.status === 200 && apiKey.startsWith("mh_"));
const keyRow = d1Json(`SELECT key_hash FROM api_clients WHERE name='${clientName.replace(/'/g, "''")}';`)[0]?.results?.[0];
check("API key stored hashed", Boolean(keyRow?.key_hash) && keyRow.key_hash !== apiKey && !keyRow.key_hash.includes(apiKey));

// ---------------- settings ----------------
const settingsPage = await adminPage(adminJar, "/admin/settings");
check("settings page renders", settingsPage.response.status === 200 && settingsPage.text.includes("Thông tin website"));
const settingsSave = await form(adminJar, "/admin/settings", { site_name: "M2 QA Site", site_tagline: "QA", site_description: "QA description", contact_email: "", social_twitter: "", social_facebook: "", default_author_id: "", copyright: "QA copyright", allow_ai_crawlers: "0" }, "/admin/settings");
check("settings save", settingsSave.response.status === 302);
await new Promise((resolve) => setTimeout(resolve, 6000));
const publicSettings = await publicPage("/");
check("settings affect public title", publicSettings.text.includes("M2 QA Site"));
await form(adminJar, "/admin/settings", { site_name: "Mẹo Hay Mỗi Ngày", site_tagline: "Mẹo vặt đời sống & công nghệ — dễ làm, không tốn tiền", site_description: "Mẹo Hay Mỗi Ngày — blog mẹo vặt đời sống: nhà cửa gọn thơm, ăn uống và bảo quản thực phẩm, ngủ ngon khỏe người, cùng mẹo công nghệ như wifi nhanh hơn, điện thoại mượt hơn. Mỗi bài một vấn đề, làm theo từng bước trong vài phút.", contact_email: "", social_twitter: "", social_facebook: "", default_author_id: "", copyright: "Nội dung và hình ảnh thuộc Mẹo Hay Mỗi Ngày, vui lòng không sao chép khi chưa được đồng ý.", allow_ai_crawlers: "0" }, "/admin/settings");

// ---------------- media ----------------
const mediaPage = await adminPage(adminJar, "/admin/media");
check("media page shows legacy and blocked upload", mediaPage.response.status === 200 && mediaPage.text.includes("Ảnh legacy") && mediaPage.text.includes("Static Assets không nhận upload trực tiếp"));
const mediaForm = new FormData();
mediaForm.append("_csrf", csrfFrom(mediaPage.text));
mediaForm.append("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "tiny.jpg");
const mediaUpload = await request(adminJar, "/admin/media", { method: "POST", body: mediaForm });
check("media upload blocked", mediaUpload.response.status === 302 && mediaUpload.response.headers.get("location")?.includes("err=media_blocked"));

// ---------------- audit ----------------
const auditPage = await adminPage(adminJar, "/admin/audit");
check("audit log renders", auditPage.response.status === 200 && auditPage.text.includes("post.created") && auditPage.text.includes("auth.login"));

// ---------------- logout ----------------
const logout = await form(adminJar, "/admin/logout", {}, "/admin");
check("logout", logout.response.status === 302 && logout.response.headers.get("location")?.includes("logged_out"));
const afterLogout = await request(adminJar, "/admin");
check("session revoked after logout", afterLogout.response.status === 302 && afterLogout.response.headers.get("location")?.startsWith("/admin/login"));

// ---------------- cleanup ----------------
d1(`
DELETE FROM posts_fts WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${P}%');
DELETE FROM post_tags WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${P}%');
DELETE FROM post_tags WHERE tag_id IN (SELECT id FROM tags WHERE slug LIKE '${P}%');
DELETE FROM revisions WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${P}%');
DELETE FROM slug_history WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${P}%');
DELETE FROM posts WHERE slug LIKE '${P}%';
DELETE FROM tags WHERE slug LIKE '${P}%';
UPDATE posts SET category_id = NULL WHERE category_id IN (SELECT id FROM categories WHERE slug LIKE '${P}%');
DELETE FROM categories WHERE slug LIKE '${P}%';
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${P}%');
DELETE FROM login_attempts WHERE email LIKE '${P}%';
DELETE FROM users WHERE email LIKE '${P}%';
DELETE FROM api_clients WHERE name LIKE 'M2QA client ${stamp}%';
DELETE FROM audit_log WHERE meta LIKE '%${P}%' OR action LIKE 'm2qa.%';
`);

const failed = results.filter((item) => !item.ok);
fs.writeFileSync(`fixtures/m2-test-${stamp}.json`, JSON.stringify({ stamp, results, passed: results.length - failed.length, failed: failed.length }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

async function loginWith(email, password, jar) {
  const page = await request(jar, "/admin/login");
  const csrf = csrfFrom(page.text);
  return request(jar, "/admin/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, email, password }),
  });
}
