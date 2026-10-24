import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function resolvePath(value, fallback) {
  const p = value && value.trim() ? value.trim() : fallback;
  return path.isAbsolute(p) ? p : path.join(rootDir, p);
}

const nodeEnv = process.env.NODE_ENV || "development";
const siteUrl = (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

export const config = {
  rootDir,
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: intEnv("PORT", 3000),
  siteUrl,
  secureCookies: siteUrl.startsWith("https://"),
  trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
  dbPath: resolvePath(process.env.DB_PATH, "data/blog.db"),
  uploadDir: resolvePath(process.env.UPLOAD_DIR, "data/uploads"),
  publicDir: path.join(rootDir, "public"),
  sessionTtlHours: intEnv("SESSION_TTL_HOURS", 168),
  sessionIdleHours: intEnv("SESSION_IDLE_HOURS", 8),
  maxUploadBytes: intEnv("MAX_UPLOAD_MB", 8) * 1024 * 1024,
  maxUploadMb: intEnv("MAX_UPLOAD_MB", 8),
  rateLimitHtmlPerMin: intEnv("RATE_LIMIT_HTML_PER_MIN", 120),
  rateLimitApiPerMin: intEnv("RATE_LIMIT_API_PER_MIN", 60),
  blockAiCrawlers: boolEnv("BLOCK_AI_CRAWLERS", true),
  blockScraperUas: boolEnv("BLOCK_SCRAPER_UAS", true),
  backupRetentionDays: intEnv("BACKUP_RETENTION_DAYS", 14),
  timezone: process.env.SITE_TIMEZONE || "Asia/Ho_Chi_Minh",
  adminEmail: process.env.ADMIN_EMAIL || "admin@meohay.local",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  sessionCookieName: "mh_session",
  csrfCookieName: "mh_csrf",
};

export const SITE = {
  name: "Mẹo Hay Mỗi Ngày",
  tagline: "Mẹo vặt đời sống & công nghệ — dễ làm, không tốn tiền",
  description:
    "Mẹo Hay Mỗi Ngày — blog mẹo vặt đời sống: nhà cửa gọn thơm, ăn uống và bảo quản thực phẩm, ngủ ngon khỏe người, cùng mẹo công nghệ như wifi nhanh hơn, điện thoại mượt hơn. Mỗi bài một vấn đề, làm theo từng bước trong vài phút.",
  locale: "vi_VN",
  lang: "vi",
  authorFallback: "Bé Dâu",
};

export const ROLES = ["admin", "editor", "author"];
export const POST_STATUSES = ["draft", "review", "scheduled", "published", "archived"];
export const API_SCOPES = [
  "posts:read",
  "posts:write",
  "posts:publish",
  "media:write",
  "taxonomy:read",
];
