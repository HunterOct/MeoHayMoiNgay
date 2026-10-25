import fs from "node:fs";
import { validateImageUpload, mediaFilenameFromUrl } from "../src/media-policy.js";
import { getMediaProvider, mediaEnabled, mediaRefererAllowed } from "../src/media.js";
import { uploadMedia } from "../src/media-service.js";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const jpeg = new Uint8Array(fs.readFileSync("public/assets/img/img-001.jpg"));
const valid = validateImageUpload(jpeg, { originalName: "img-001.jpg", declaredMime: "image/jpeg" });
check("valid JPEG accepted", valid.ok && valid.width === 980 && valid.height === 735, `${valid.width}x${valid.height}`);
check("original name sanitized", valid.originalName === "img-001.jpg");

const webp = new Uint8Array(fs.readFileSync("public/assets/img/img-004.webp"));
const validWebp = validateImageUpload(webp, { originalName: "img-004.webp", declaredMime: "image/webp" });
check("valid WebP accepted", validWebp.ok && validWebp.mime === "image/webp");

const invalid = validateImageUpload(new TextEncoder().encode("not an image at all"), { originalName: "x.txt" });
check("non-image rejected", !invalid.ok && invalid.code === "invalid_image");

const mismatch = validateImageUpload(jpeg, { originalName: "img.jpg", declaredMime: "image/png" });
check("MIME mismatch rejected", !mismatch.ok && mismatch.code === "mime_mismatch");

const tooLarge = validateImageUpload(new Uint8Array(8 * 1024 * 1024 + 1), { originalName: "big.jpg" });
check("oversized upload rejected", !tooLarge.ok && tooLarge.code === "too_large");

const fakePng = new Uint8Array(33);
fakePng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
fakePng.set([0x49, 0x48, 0x44, 0x52], 12);
const view = new DataView(fakePng.buffer);
view.setUint32(16, 9000);
view.setUint32(20, 9000);
const huge = validateImageUpload(fakePng, { originalName: "huge.png", declaredMime: "image/png" });
check("oversized dimensions rejected", !huge.ok && huge.code === "image_too_large");

const env = { SITE_URL: "https://meohay.example" };
check("same-site referer allowed", mediaRefererAllowed(env, "https://meohay.example/bai-viet/x"));
check("google referer allowed", mediaRefererAllowed(env, "https://www.google.com/"));
check("unknown referer blocked", !mediaRefererAllowed(env, "https://evil.example/"));
check("empty referer allowed", mediaRefererAllowed(env, ""));

check("media URL parser", mediaFilenameFromUrl("/media/abc-123.webp") === "abc-123.webp");
check("media URL traversal rejected", mediaFilenameFromUrl("/media/../secret") === null);
check("media disabled without provider", !mediaEnabled({}) && getMediaProvider({}).provider === "none");

const disabled = await uploadMedia({ DB: {}, SITE_URL: env.SITE_URL }, {
  bytes: jpeg,
  originalName: "img-001.jpg",
  declaredMime: "image/jpeg",
});
check("upload returns 501 when provider disabled", disabled.error?.status === 501 && disabled.error?.code === "media_not_configured");

const puts = [];
let deletes = 0;
const failingDb = {
  prepare() {
    return { bind() { return { async run() { throw new Error("db down"); } }; } };
  },
};
let rollbackError = null;
try {
  await uploadMedia({
    SITE_URL: env.SITE_URL,
    MEDIA_PROVIDER: "r2",
    MEDIA: { async put(key) { puts.push(key); }, async delete() { deletes += 1; } },
    DB: failingDb,
  }, { bytes: jpeg, originalName: "img-001.jpg", declaredMime: "image/jpeg" });
} catch (error) {
  rollbackError = error;
}
check("failed metadata insert rolls back object", Boolean(rollbackError) && puts.length === 1 && deletes === 1, `puts=${puts.length} deletes=${deletes}`);

let inserted = null;
const okDb = {
  prepare() {
    return { bind(...values) { return { async run() { inserted = values; } }; } };
  },
};
const success = await uploadMedia({
  SITE_URL: env.SITE_URL,
  MEDIA_PROVIDER: "r2",
  MEDIA: { async put() {}, async delete() {} },
  DB: okDb,
}, { bytes: jpeg, originalName: "img-001.jpg", declaredMime: "image/jpeg", alt: "  Ảnh   thử  " });
check("successful upload returns metadata", success.data?.mime === "image/jpeg" && success.data?.alt === "Ảnh thử");
check("metadata insert has expected columns", inserted?.length === 16, `${inserted?.length} values`);

const failed = results.filter((item) => !item.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
