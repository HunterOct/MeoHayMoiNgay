import fs from "node:fs";
import path from "node:path";
import { openDatabase, closeDb } from "../src/db/index.js";
import { config } from "../src/config.js";
import { ensureAdmin } from "./lib/admin.js";
import { LEGACY_CATEGORIES, tagsForLegacy } from "./lib/legacy-taxonomy.js";
import { loadLegacyArticles, decodeBody } from "./lib/legacy-data.js";
import { createCategory, listCategories } from "../src/db/taxonomy.js";
import { createPost, getAnyBySlug, getTrashedBySlug, syncAllFts } from "../src/db/posts.js";
import { imageSize } from "../src/lib/image-size.js";
import { sanitizeContent } from "../src/lib/sanitize.js";
import { readingMinutes } from "../src/lib/time.js";
import { slugify } from "../src/lib/slug.js";

const legacyFile = path.join(config.rootDir, "scripts/legacy/main.js");
const force = process.argv.includes("--force");

openDatabase(config.dbPath);
const admin = await ensureAdmin();

const categoryByKey = new Map();
for (const [key, category] of Object.entries(LEGACY_CATEGORIES)) {
  const found = listCategories().find((c) => c.slug === category.slug);
  categoryByKey.set(
    key,
    found ||
      createCategory({
        name: category.name,
        slug: category.slug,
        group: category.group,
        description: category.description,
        sortOrder: category.sort,
      }),
  );
}

const articles = loadLegacyArticles(legacyFile);
console.log(`Legacy articles found: ${articles.length}`);

let imported = 0;
let skipped = 0;
let missingImages = 0;

for (const article of articles) {
  const slug = slugify(article.id);
  if (!force && (getAnyBySlug(slug) || getTrashedBySlug(slug))) {
    skipped += 1;
    continue;
  }
  const category = categoryByKey.get(article.cat);
  const [day, month, year] = String(article.date || "").split("/");
  const publishedAt =
    day && month && year
      ? new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 1, 0, 0)).toISOString()
      : new Date().toISOString();
  const coverImage = String(article.img || "").replace(/^assets\//, "/assets/");
  const localImage = path.join(config.rootDir, "public", coverImage.replace(/^\//, ""));
  if (coverImage && !fs.existsSync(localImage)) missingImages += 1;
  const dims = coverImage && fs.existsSync(localImage) ? imageSize(localImage) : null;

  const contentHtml = sanitizeContent(decodeBody(article.bodyEnc));
  const readMatch = /(\d+)\s*phút/.exec(article.read || "");
  const minutes = readMatch ? Number(readMatch[1]) : readingMinutes(contentHtml);

  createPost(
    {
      slug,
      title: article.title,
      excerpt: article.excerpt || "",
      lede: article.lede || "",
      contentHtml,
      contentSource: contentHtml,
      contentFormat: "html",
      status: "published",
      categoryId: category ? category.id : null,
      authorId: admin.user.id,
      coverImage,
      coverAlt: article.imgAlt || "",
      coverCaption: article.caption || "",
      seoTitle: "",
      seoDescription: article.excerpt || "",
      ogImage: coverImage,
      isFeatured: false,
      readMinutes: minutes,
      publishedAt,
      tags: tagsForLegacy(article),
      origin: "legacy",
    },
    { actorType: "system", actorId: null },
  );
  imported += 1;
}

syncAllFts();
closeDb();

console.log(`Imported: ${imported}`);
console.log(`Skipped (already exists): ${skipped}`);
console.log(`Missing cover images: ${missingImages}`);
console.log("Done.");
