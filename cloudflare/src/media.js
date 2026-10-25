import { mediaUrl } from "./media-policy.js";

function disabled(reason, provider = "none") {
  return {
    provider,
    enabled: false,
    reason,
    async put() {
      throw new Error("Media storage is not configured.");
    },
    async get() {
      return null;
    },
    async delete() {
      return null;
    },
  };
}

export function getMediaProvider(env) {
  const requested = String(env.MEDIA_PROVIDER || "").toLowerCase();
  if (!requested) {
    return disabled("MEDIA_PROVIDER is not configured. Dynamic media upload is unavailable.");
  }
  if (requested === "static") {
    return disabled("Static Assets media is ingested by the trusted deploy runner.", "static");
  }
  if (requested !== "r2") {
    return disabled(`Unsupported media provider: ${requested}.`, requested);
  }
  if (!env.MEDIA) {
    return disabled("MEDIA_PROVIDER=r2 but the R2 binding is missing.", "r2");
  }
  return {
    provider: "r2",
    enabled: true,
    reason: "",
    async put(key, bytes, options) {
      return env.MEDIA.put(key, bytes, options);
    },
    async get(key) {
      return env.MEDIA.get(key);
    },
    async delete(key) {
      return env.MEDIA.delete(key);
    },
  };
}

export function mediaEnabled(env) {
  return getMediaProvider(env).enabled;
}

export function mediaObjectKey(filename) {
  return `media/${filename}`;
}

export function mediaPublicUrl(filename) {
  return mediaUrl(filename);
}

export function mediaRefererAllowed(env, referer) {
  if (!referer) return true;
  let host;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "127.0.0.1" || host === "localhost") return true;
  try {
    if (host === new URL(env.SITE_URL).hostname.toLowerCase()) return true;
  } catch {
    // ignore malformed SITE_URL
  }
  return /(^|\.)google\./.test(host) || /(^|\.)bing\./.test(host);
}
