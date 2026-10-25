import fs from "node:fs";
import path from "node:path";
import { renderArticlePage, renderHomePage } from "../src/render.js";

const fixture = JSON.parse(fs.readFileSync("fixtures/articles.json", "utf8"));
const siteUrl = process.env.SITE_URL || "http://127.0.0.1:8787";
const root = "public";
let bytes = 0;
let files = 0;

for (const post of fixture.posts) {
  const related = fixture.posts.filter((item) => item.id !== post.id).slice(0, 4);
  const html = renderArticlePage(post, { siteUrl, related });
  const dir = path.join(root, "bai-viet");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${post.slug}.html`), html);
  bytes += Buffer.byteLength(html);
  files += 1;
}

const home = renderHomePage(fixture.posts, fixture.categories, { siteUrl });
fs.writeFileSync(path.join(root, "index.html"), home);
bytes += Buffer.byteLength(home);
files += 1;

console.log(JSON.stringify({ files, bytes, articlePages: fixture.posts.length, homePage: true }));
