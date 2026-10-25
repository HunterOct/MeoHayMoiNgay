import { SITE } from "./config.js";

export const DEFAULT_SETTINGS = {
  site_name: SITE.name,
  site_tagline: SITE.tagline,
  site_description: SITE.description,
  contact_email: "",
  social_twitter: "",
  social_facebook: "",
  default_author_id: "",
  copyright:
    "Nội dung và hình ảnh thuộc Mẹo Hay Mỗi Ngày, vui lòng không sao chép khi chưa được đồng ý.",
  allow_ai_crawlers: "0",
};

let cache = { at: 0, values: null };
const TTL_MS = 5000;

export async function getSettings(db) {
  const now = Date.now();
  if (cache.values && now - cache.at < TTL_MS) return cache.values;
  const values = { ...DEFAULT_SETTINGS };
  try {
    const result = await db.prepare("SELECT key, value FROM settings").all();
    for (const row of result.results || []) values[row.key] = row.value;
  } catch {
    // Older/local databases may not have the settings table yet.
  }
  cache = { at: now, values };
  return values;
}

export function invalidateSettingsCache() {
  cache = { at: 0, values: null };
}

export async function setSettings(db, values) {
  const statements = Object.entries(values).map(([key, value]) =>
    db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(key, String(value ?? "")),
  );
  if (statements.length) await db.batch(statements);
  invalidateSettingsCache();
  return getSettings(db);
}
