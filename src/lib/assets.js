import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

const FILES = [
  "assets/css/style.css",
  "assets/css/site.css",
  "assets/css/admin.css",
  "assets/js/site.js",
  "assets/js/admin.js",
  "favicon.svg",
];

let version = null;

function computeVersion() {
  const hash = crypto.createHash("sha1");
  for (const relative of FILES) {
    const full = path.join(config.publicDir, relative);
    try {
      const stat = fs.statSync(full);
      hash.update(`${relative}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      hash.update(relative);
    }
  }
  return hash.digest("hex").slice(0, 10);
}

export function assetVersion() {
  if (!version) version = computeVersion();
  return version;
}

export function asset(relative) {
  const clean = relative.startsWith("/") ? relative : `/${relative}`;
  return `${clean}?v=${assetVersion()}`;
}
