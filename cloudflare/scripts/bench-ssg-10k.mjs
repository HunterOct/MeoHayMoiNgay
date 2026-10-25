import fs from "node:fs";
import path from "node:path";
import { renderArticlePage } from "../src/render.js";

const fixture = JSON.parse(fs.readFileSync("fixtures/articles.json", "utf8"));
const base = fixture.posts[0];
const out = "tmp-ssg";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const started = performance.now();
let bytes = 0;
for (let i = 0; i < 10000; i += 1) {
  const post = {
    ...base,
    id: `ssg-${i}`,
    slug: `ssg-${i}`,
    title: `Synthetic SSG post ${i}`,
    excerpt: `Synthetic excerpt ${i}`,
    lede: `Synthetic lede ${i}`,
    published_at: new Date(Date.UTC(2026, 0, 1 + (i % 300))).toISOString(),
    updated_at: new Date(Date.UTC(2026, 0, 1 + (i % 300))).toISOString(),
  };
  const html = renderArticlePage(post, {
    siteUrl: "http://127.0.0.1:8787",
    related: fixture.posts.slice(0, 4),
  });
  bytes += Buffer.byteLength(html);
  const dir = path.join(out, "bai-viet");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${post.slug}.html`), html);
}
const ms = performance.now() - started;
console.log(
  JSON.stringify({
    pages: 10000,
    bytes,
    mb: Number((bytes / 1024 / 1024).toFixed(2)),
    renderAndWriteMs: Number(ms.toFixed(1)),
    perPageMs: Number((ms / 10000).toFixed(3)),
    note: "Local Node render+write only; excludes deploy/upload and Cloudflare build.",
  }),
);
fs.rmSync(out, { recursive: true, force: true });
