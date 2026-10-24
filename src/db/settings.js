import { getDb } from "./index.js";
import { SITE } from "../config.js";

const DEFAULTS = {
  site_name: SITE.name,
  site_tagline: SITE.tagline,
  site_description: SITE.description,
  default_author_id: "",
  contact_email: "",
  social_twitter: "",
  social_facebook: "",
  allow_ai_crawlers: "0",
  copyright: "Nội dung và hình ảnh thuộc Mẹo Hay Mỗi Ngày, vui lòng không sao chép khi chưa được đồng ý.",
};

let cache = { at: 0, values: null };
const TTL_MS = 5000;

export function getSettings() {
  const now = Date.now();
  if (cache.values && now - cache.at < TTL_MS) return cache.values;
  const rows = getDb().prepare("SELECT key, value FROM settings").all();
  const values = { ...DEFAULTS };
  for (const row of rows) values[row.key] = row.value;
  cache = { at: now, values };
  return values;
}

export function getSetting(key) {
  return getSettings()[key] ?? "";
}

export function setSetting(key, value) {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, String(value ?? ""));
  cache = { at: 0, values: null };
}

export function setSettings(values) {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) stmt.run(key, String(value ?? ""));
  })();
  cache = { at: 0, values: null };
}

export function resetSettingsCache() {
  cache = { at: 0, values: null };
}

export function boolSetting(key, fallback = false) {
  const value = getSettings()[key];
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "on";
}
