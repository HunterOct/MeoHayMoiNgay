import dns from "node:dns/promises";
import { config } from "../config.js";
import { logAuditThrottled } from "../db/audit.js";
import { clientIp, isPrivateIp } from "./security.js";
import { logger } from "../lib/logger.js";

const SEARCH_BOTS = [
  { name: "googlebot", ua: /Googlebot/i, domains: ["googlebot.com", "google.com"] },
  { name: "bingbot", ua: /bingbot/i, domains: ["search.msn.com"] },
  { name: "duckduckbot", ua: /DuckDuckBot/i, domains: ["duckduckgo.com"] },
  { name: "yandexbot", ua: /YandexBot/i, domains: ["yandex.com", "yandex.ru"] },
  { name: "baiduspider", ua: /Baiduspider/i, domains: ["baidu.com", "baidu.jp"] },
  { name: "applebot", ua: /Applebot(?!-Extended)/i, domains: ["applebot.apple.com"] },
];

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

const verifyCache = new Map();
const VERIFY_TTL = 30 * 60 * 1000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("dns_timeout")), ms)),
  ]);
}

async function verifySearchBot(ip, bot) {
  const cacheKey = `${ip}:${bot.name}`;
  const cached = verifyCache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.verified;
  let verified = false;
  try {
    const hostnames = await withTimeout(dns.reverse(ip), 2000);
    for (const hostname of hostnames) {
      const lower = hostname.toLowerCase();
      if (!lower.endsWith(`.${bot.domains[0]}`) && !bot.domains.some((d) => lower.endsWith(`.${d}`))) {
        continue;
      }
      const addresses = await withTimeout(dns.lookup(hostname, { all: true }), 2000);
      if (addresses.some((entry) => entry.address === ip)) {
        verified = true;
        break;
      }
    }
  } catch (error) {
    logger.warn("bot.verify_failed", { ip, bot: bot.name, error: error.message });
  }
  verifyCache.set(cacheKey, { verified, until: Date.now() + VERIFY_TTL });
  if (verifyCache.size > 2000) verifyCache.clear();
  return verified;
}

/** Classifies requests, verifies search engines and blocks known scrapers/AI crawlers. */
export async function botGuard(req, res, next) {
  const ip = clientIp(req);
  const ua = req.get("user-agent") || "";
  req.isVerifiedBot = false;
  req.skipViewCount = false;

  const searchBot = SEARCH_BOTS.find((bot) => bot.ua.test(ua));
  if (searchBot) {
    if (isPrivateIp(ip)) {
      req.isVerifiedBot = true;
      req.botName = searchBot.name;
      req.skipViewCount = true;
      return next();
    }
    const verified = await verifySearchBot(ip, searchBot);
    if (verified) {
      req.isVerifiedBot = true;
      req.botName = searchBot.name;
      req.skipViewCount = true;
      return next();
    }
    req.skipViewCount = true;
    logAuditThrottled({
      actorType: "system",
      action: "security.bot_spoof",
      meta: { claimed: searchBot.name, ua: ua.slice(0, 160), path: req.path },
      ip,
      userAgent: ua,
    });
    logger.warn("bot.unverified_search_bot", { ip, bot: searchBot.name });
    return next();
  }

  if (config.blockAiCrawlers && AI_CRAWLERS.some((pattern) => pattern.test(ua))) {
    logAuditThrottled({
      actorType: "system",
      action: "security.blocked_ai_crawler",
      meta: { ua: ua.slice(0, 160), path: req.path },
      ip,
      userAgent: ua,
    });
    return res.status(403).type("text/plain").send("Crawler không được phép truy cập nội dung này.");
  }

  if (config.blockScraperUas && SCRAPER_UA.some((pattern) => pattern.test(ua))) {
    logAuditThrottled({
      actorType: "system",
      action: "security.blocked_scraper",
      meta: { ua: ua.slice(0, 160), path: req.path },
      ip,
      userAgent: ua,
    });
    return res.status(403).type("text/plain").send("Truy cập tự động không được phép.");
  }

  return next();
}

/** Hotlink protection for uploaded media (search engines and social previews allowed). */
export function hotlinkGuard(req, res, next) {
  const referer = req.get("referer");
  if (!referer) return next();
  let host;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return next();
  }
  const self = new URL(config.siteUrl).hostname.toLowerCase();
  const selfBase = self.replace(/^www\./, "");
  const refererBase = host.replace(/^www\./, "");
  if (
    refererBase === selfBase ||
    host.endsWith(`.${self}`) ||
    host === "localhost" ||
    host === "127.0.0.1"
  ) {
    return next();
  }
  const allowed =
    /(^|\.)google\.[a-z.]+$/.test(host) ||
    /(^|\.)googleusercontent\.com$/.test(host) ||
    /(^|\.)bing\.com$/.test(host) ||
    /(^|\.)duckduckgo\.com$/.test(host) ||
    /(^|\.)facebook\.com$/.test(host) ||
    /(^|\.)x\.com$/.test(host) ||
    /(^|\.)twitter\.com$/.test(host) ||
    /(^|\.)pinterest\.[a-z.]+$/.test(host) ||
    /(^|\.)zalo\.me$/.test(host);
  if (allowed) return next();
  logAuditThrottled({
    actorType: "system",
    action: "security.hotlink_blocked",
    meta: { referer: referer.slice(0, 200), path: req.path },
    ip: clientIp(req),
    userAgent: req.get("user-agent") || "",
  });
  return res.status(403).type("text/plain").send("Hotlink không được phép.");
}
