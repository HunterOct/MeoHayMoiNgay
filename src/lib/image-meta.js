import path from "node:path";
import { config } from "../config.js";
import { imageSize } from "./image-size.js";

const cache = new Map();

/** Dimensions for locally stored images, to avoid layout shift. */
export function imageDims(url) {
  const value = String(url || "");
  if (!value) return null;
  if (cache.has(value)) return cache.get(value);
  let file = null;
  let size = null;
  if (value.startsWith("/assets/")) {
    file = path.join(config.publicDir, value.replace(/^\//, ""));
  } else if (value.startsWith("/media/")) {
    file = path.join(config.uploadDir, value.slice("/media/".length));
  }
  if (file) size = imageSize(file);
  const result = size && size.width && size.height ? size : null;
  cache.set(value, result);
  if (cache.size > 500) cache.clear();
  return result;
}

export function imgDimsAttrs(url) {
  const dims = imageDims(url);
  return dims ? ` width="${dims.width}" height="${dims.height}"` : "";
}
