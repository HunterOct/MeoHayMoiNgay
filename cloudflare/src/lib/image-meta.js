import { esc } from "../views/helpers.js";
import { IMAGE_DIMENSIONS } from "./image-dimensions.js";
import { IMAGE_VARIANTS } from "./image-variants.js";

/** Dimensions and responsive variants for bundled legacy images. */
export function imageInfo(url) {
  const value = String(url || "");
  if (!value.startsWith("/assets/")) return null;
  const dimensions = IMAGE_DIMENSIONS[value];
  const variants = IMAGE_VARIANTS[value];
  if (!dimensions && !variants) return null;
  return {
    width: variants?.width || dimensions?.width || 0,
    height: variants?.height || dimensions?.height || 0,
    webp: variants?.webp || [],
  };
}

export function imageDims(url) {
  const info = imageInfo(url);
  return info?.width && info?.height ? info : null;
}

export function imgDimsAttrs(url) {
  const dims = imageDims(url);
  return dims ? ` width="${dims.width}" height="${dims.height}"` : "";
}

export function preloadImageUrl(url) {
  const info = imageInfo(url);
  if (!info?.webp?.length) return url;
  const preferred = info.webp.find((variant) => variant.width >= 960) || info.webp[info.webp.length - 1];
  return preferred.url;
}

export function preloadImageSrcSet(url) {
  const info = imageInfo(url);
  if (!info?.webp?.length) return "";
  return info.webp.map((variant) => `${variant.url} ${variant.width}w`).join(", ");
}

export function imagePicture(url, {
  alt = "",
  className = "",
  sizes = "(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 560px",
  eager = false,
  loading = "lazy",
} = {}) {
  const info = imageInfo(url);
  const classAttr = className ? ` class="${esc(className)}"` : "";
  const loadingAttrs = eager ? ' fetchpriority="high"' : ` loading="${esc(loading)}"`;
  if (!info?.webp?.length) {
    return `<img draggable="false" src="${esc(url)}" alt="${esc(alt)}"${imgDimsAttrs(url)}${classAttr}${loadingAttrs} decoding="async" />`;
  }
  const srcset = info.webp.map((variant) => `${variant.url} ${variant.width}w`).join(", ");
  return `<picture${classAttr}><source type="image/webp" srcset="${esc(srcset)}" sizes="${esc(sizes)}" /><img draggable="false" src="${esc(url)}" alt="${esc(alt)}" width="${info.width}" height="${info.height}" loading="${eager ? "eager" : esc(loading)}" decoding="async"${eager ? ' fetchpriority="high"' : ""} /></picture>`;
}
