import { config } from "./config.js";

const SCRAPER_UA = [
  /python-requests/i, /python-urllib/i, /aiohttp/i, /\bhttpx\//i, /scrapy/i,
  /curl\//i, /wget\//i, /httpie/i, /go-http-client/i, /libwww-perl/i,
  /scrapingbee/i, /scrapingant/i, /apify/i,
];

const AI_CRAWLERS = [
  /GPTBot/i, /ChatGPT-User/i, /CCBot/i, /\bClaudeBot\b/i, /Claude-Web/i, /anthropic-ai/i,
  /Bytespider/i, /PerplexityBot/i, /cohere-ai/i, /Diffbot/i, /Omgilibot/i,
  /ImagesiftBot/i, /Meta-ExternalAgent/i, /Meta-ExternalFetcher/i,
  /Amazonbot/i, /Applebot-Extended/i, /YouBot/i,
];

export function newNonce() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function isBlockedUserAgent(value, allowAi = false) {
  const ua = String(value || "");
  if (config.blockAiCrawlers && !allowAi && AI_CRAWLERS.some((pattern) => pattern.test(ua))) return "ai";
  if (config.blockScraperUas && SCRAPER_UA.some((pattern) => pattern.test(ua))) return "scraper";
  return null;
}

export function applySecurityHeaders(c, nonce) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "media-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (config.secureCookies) directives.push("upgrade-insecure-requests");
  c.header("Content-Security-Policy", directives.join("; "));
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Request-Id", crypto.randomUUID());
  if (config.secureCookies) {
    c.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
}

export function applyHtmlCache(c) {
  // No edge cache is enabled on workers.dev; this keeps SSR content immediately consistent.
  c.header("Cache-Control", "public, max-age=0, must-revalidate");
  c.header("CDN-Cache-Control", "no-store");
}

export function applyNoStore(c) {
  c.header("Cache-Control", "no-store");
  c.header("CDN-Cache-Control", "no-store");
}
