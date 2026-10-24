import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { slugify, uniqueSlug } from "../src/lib/slug.js";
import { sanitizeContent, renderMarkdown, excerptFrom, escapeHtml } from "../src/lib/sanitize.js";
import { hashPassword, verifyPassword, passwordProblem } from "../src/lib/passwords.js";
import { imageSize, sniffImageMime } from "../src/lib/image-size.js";
import { readingMinutes, formatDate, fromLocalInput } from "../src/lib/time.js";
import { PNG_1PX } from "./support.js";

const imagePath = fileURLToPath(new URL("../public/assets/img/img-001.jpg", import.meta.url));

test("slugify handles Vietnamese and punctuation", () => {
  assert.equal(slugify("Wifi nhà chậm, lag khi xem YouTube?"), "wifi-nha-cham-lag-khi-xem-youtube");
  assert.equal(slugify("Điện thoại & máy tính"), "dien-thoai-may-tinh");
  assert.equal(slugify("   "), "");
  assert.equal(slugify("a".repeat(120)).length <= 90, true);
});

test("uniqueSlug appends suffixes", () => {
  const taken = new Set(["bai-viet", "bai-viet-2"]);
  assert.equal(uniqueSlug("Bài viết", (slug) => taken.has(slug)), "bai-viet-3");
});

test("sanitizeContent removes scripts, handlers and unsafe URLs", () => {
  const cleaned = sanitizeContent(
    `<p onclick="x()">Hi <script>alert(1)</script><img src="x" onerror="alert(1)" /></p><a href="javascript:alert(1)">bad</a>`,
  );
  assert.equal(/<script/i.test(cleaned), false);
  assert.equal(/onerror/i.test(cleaned), false);
  assert.equal(/onclick/i.test(cleaned), false);
  assert.equal(/javascript:/i.test(cleaned), false);
});

test("renderMarkdown sanitizes raw HTML and adds safe rel", () => {
  const html = renderMarkdown(
    "## Tiêu đề\n\n**Đậm** và [liên kết](https://example.com)\n\n<script>alert(1)</script>",
  );
  assert.match(html, /<h2>Tiêu đề<\/h2>/);
  assert.match(html, /<strong>Đậm<\/strong>/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.equal(/<script/i.test(html), false);
});

test("excerptFrom and escapeHtml", () => {
  assert.equal(excerptFrom("<p>Xin chào thế giới</p>", 100), "Xin chào thế giới");
  assert.match(excerptFrom(`<p>${"từ ".repeat(120)}</p>`, 60), /…$/);
  assert.equal(escapeHtml('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
});

test("password hashing verifies and rejects wrong passwords", async () => {
  const hash = await hashPassword("MatKhau12345");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("MatKhau12345", hash), true);
  assert.equal(await verifyPassword("sai-mat-khau", hash), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  assert.match(passwordProblem("ngan"), /tối thiểu/);
  assert.match(passwordProblem("1234567890123"), /chữ và số/);
  assert.equal(passwordProblem("MatKhau12345"), null);
});

test("image dimensions and mime sniffing", () => {
  const size = imageSize(imagePath);
  assert.ok(size && size.width > 0 && size.height > 0, JSON.stringify(size));
  assert.equal(sniffImageMime(PNG_1PX), "image/png");
  const pngSize = imageSize(fileURLToPath(new URL("./support.js", import.meta.url)));
  assert.equal(pngSize, null);
});

test("reading time and date formatting", () => {
  assert.equal(readingMinutes("word ".repeat(400)), 2);
  assert.equal(readingMinutes(""), 1);
  assert.equal(formatDate("2026-10-24T01:00:00.000Z"), "24/10/2026");
  const iso = fromLocalInput("2026-10-25T08:00");
  assert.equal(iso, "2026-10-25T01:00:00.000Z");
});
