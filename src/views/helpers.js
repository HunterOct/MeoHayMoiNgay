import { config } from "../config.js";

export const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const absUrl = (pathname = "/") => {
  try {
    return new URL(pathname, config.siteUrl).toString();
  } catch {
    return config.siteUrl;
  }
};

export const postUrl = (post) => `/bai-viet/${encodeURIComponent(post.slug)}`;
export const categoryUrl = (category) => `/chuyen-muc/${encodeURIComponent(category.slug)}`;
export const tagUrl = (tag) => `/the/${encodeURIComponent(tag.slug)}`;
export const groupUrl = (group) => `/nhom/${encodeURIComponent(group.slug)}`;

export function pagedUrl(base, page) {
  if (!page || page <= 1) return base;
  const clean = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${clean}/trang/${page}`;
}

export function searchUrl(q, page = 1) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/tim-kiem${qs ? `?${qs}` : ""}`;
}

export function initial(name) {
  return String(name || "?").trim().charAt(0).toUpperCase();
}

export function serializeJsonLd(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function truncate(value, max) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
