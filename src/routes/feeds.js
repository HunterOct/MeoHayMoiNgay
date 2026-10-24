import express from "express";
import { config } from "../config.js";
import { getSettings, boolSetting } from "../db/settings.js";
import { listSitemap, listPublished } from "../db/posts.js";
import { listCategories, listTags } from "../db/taxonomy.js";
import { absUrl } from "../views/helpers.js";

export const feedsRouter = express.Router();

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "CCBot",
  "Google-Extended",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "Bytespider",
  "PerplexityBot",
  "cohere-ai",
  "Diffbot",
  "Omgilibot",
  "ImagesiftBot",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "Amazonbot",
  "Applebot-Extended",
  "YouBot",
];

feedsRouter.get("/robots.txt", (req, res) => {
  const settings = getSettings();
  const blockAi = config.blockAiCrawlers && !boolSetting("allow_ai_crawlers");
  const lines = [
    "# Khuyến khích công cụ tìm kiếm; chặn crawler sao chép và huấn luyện AI.",
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /api/",
    "Disallow: /tim-kiem",
    "Disallow: /*?q=",
    "",
    "User-agent: Googlebot",
    "Allow: /",
    "",
    "User-agent: Bingbot",
    "Allow: /",
    "",
    "User-agent: DuckDuckBot",
    "Allow: /",
    "",
    "User-agent: Applebot",
    "Allow: /",
    "",
  ];
  if (blockAi) {
    for (const bot of AI_BOTS) {
      lines.push(`User-agent: ${bot}`, "Disallow: /", "");
    }
  }
  lines.push(`Sitemap: ${absUrl("/sitemap.xml")}`);
  lines.push(`# ${settings.site_name}`);
  res.type("text/plain").setHeader("Cache-Control", "public, max-age=3600");
  res.send(`${lines.join("\n")}\n`);
});

feedsRouter.get("/sitemap.xml", (req, res) => {
  const posts = listSitemap();
  const categories = listCategories({ withCounts: true }).filter((c) => c.post_count > 0);
  const tags = listTags({ withCounts: true }).filter((t) => t.post_count > 0);
  const entries = [];

  entries.push(`<url><loc>${xmlEscape(absUrl("/"))}</loc></url>`);
  entries.push(`<url><loc>${xmlEscape(absUrl("/bai-viet"))}</loc></url>`);
  for (const category of categories) {
    entries.push(`<url><loc>${xmlEscape(absUrl(`/chuyen-muc/${category.slug}`))}</loc></url>`);
  }
  for (const tag of tags) {
    entries.push(`<url><loc>${xmlEscape(absUrl(`/the/${tag.slug}`))}</loc></url>`);
  }
  for (const post of posts) {
    const loc = absUrl(`/bai-viet/${encodeURIComponent(post.slug)}`);
    const image = post.cover_image ? `<image:image><image:loc>${xmlEscape(absUrl(post.cover_image))}</image:loc></image:image>` : "";
    entries.push(
      `<url><loc>${xmlEscape(loc)}</loc><lastmod>${xmlEscape(post.updated_at || post.published_at)}</lastmod>${image}</url>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join("\n")}
</urlset>`;
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
  res.type("application/xml").send(xml);
});

feedsRouter.get("/rss.xml", (req, res) => {
  const settings = getSettings();
  const posts = listPublished({ perPage: 30 }).items;
  const items = posts
    .map(
      (post) => `<item>
  <title>${xmlEscape(post.title)}</title>
  <link>${xmlEscape(absUrl(`/bai-viet/${encodeURIComponent(post.slug)}`))}</link>
  <guid isPermaLink="true">${xmlEscape(absUrl(`/bai-viet/${encodeURIComponent(post.slug)}`))}</guid>
  <pubDate>${rfc822(post.published_at)}</pubDate>
  <category>${xmlEscape(post.category_name || "")}</category>
  <description>${xmlEscape(post.excerpt)}</description>
</item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xmlEscape(settings.site_name)}</title>
  <link>${xmlEscape(config.siteUrl)}</link>
  <description>${xmlEscape(settings.site_description)}</description>
  <language>vi</language>
  <lastBuildDate>${rfc822(posts[0]?.published_at)}</lastBuildDate>
  <atom:link href="${xmlEscape(absUrl("/rss.xml"))}" rel="self" type="application/rss+xml" />
${items}
</channel>
</rss>`;
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
  res.type("application/rss+xml").send(xml);
});

feedsRouter.get("/feed", (req, res) => res.redirect(301, "/rss.xml"));
feedsRouter.get("/feed.xml", (req, res) => res.redirect(301, "/rss.xml"));
