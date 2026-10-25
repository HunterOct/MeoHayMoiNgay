import { SITE, config } from "./config.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { absUrl } from "./views/helpers.js";
import { listCategoriesFast, listLatest, listSitemap, listTagsWithCounts } from "./public-data.js";

const AI_BOTS = [
  "GPTBot", "ChatGPT-User", "CCBot", "Google-Extended", "ClaudeBot", "Claude-Web",
  "anthropic-ai", "Bytespider", "PerplexityBot", "cohere-ai", "Diffbot", "Omgilibot",
  "ImagesiftBot", "Meta-ExternalAgent", "Meta-ExternalFetcher", "Amazonbot",
  "Applebot-Extended", "YouBot",
];

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

export function websiteSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function robotsTxt(settings = DEFAULT_SETTINGS) {
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
  if (config.blockAiCrawlers && settings.allow_ai_crawlers !== "1") {
    for (const bot of AI_BOTS) lines.push(`User-agent: ${bot}`, "Disallow: /", "");
  }
  lines.push(`Sitemap: ${absUrl("/sitemap.xml")}`);
  lines.push(`# ${settings.site_name || SITE.name}`);
  return `${lines.join("\n")}\n`;
}

export async function sitemapXml(db) {
  const [posts, categories, tags] = await Promise.all([
    listSitemap(db),
    listCategoriesFast(db),
    listTagsWithCounts(db),
  ]);
  const entries = [];
  entries.push(`<url><loc>${xmlEscape(absUrl("/"))}</loc></url>`);
  entries.push(`<url><loc>${xmlEscape(absUrl("/bai-viet"))}</loc></url>`);
  for (const category of categories) {
    if ((category.post_count || 0) > 0) {
      entries.push(`<url><loc>${xmlEscape(absUrl(`/chuyen-muc/${category.slug}`))}</loc></url>`);
    }
  }
  for (const tag of tags) {
    if ((tag.post_count || 0) > 0) {
      entries.push(`<url><loc>${xmlEscape(absUrl(`/the/${tag.slug}`))}</loc></url>`);
    }
  }
  for (const post of posts) {
    const loc = absUrl(`/bai-viet/${encodeURIComponent(post.slug)}`);
    const lastmod = post.updated_at || post.published_at || "";
    const image = post.cover_image
      ? `<image:image><image:loc>${xmlEscape(absUrl(post.cover_image))}</image:loc></image:image>`
      : "";
    entries.push(
      `<url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : ""}${image}</url>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join("\n")}
</urlset>`;
}

export async function rssXml(db, settings = DEFAULT_SETTINGS) {
  const posts = await listLatest(db, 30);
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
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xmlEscape(settings.site_name || SITE.name)}</title>
  <link>${xmlEscape(config.siteUrl)}</link>
  <description>${xmlEscape(settings.site_description || SITE.description)}</description>
  <language>vi</language>
  <lastBuildDate>${rfc822(posts[0]?.published_at)}</lastBuildDate>
  <atom:link href="${xmlEscape(absUrl("/rss.xml"))}" rel="self" type="application/rss+xml" />
${items}
</channel>
</rss>`;
}
