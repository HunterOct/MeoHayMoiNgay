import sanitizeHtml from "sanitize-html";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

const OPTIONS = {
  allowedTags: [
    "p", "br", "hr", "h2", "h3", "h4", "h5", "strong", "b", "em", "i", "u", "s", "del",
    "blockquote", "ul", "ol", "li", "a", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tr", "th", "td", "code", "pre", "span", "sup", "sub",
    "mark", "dl", "dt", "dd", "div",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height", "loading", "decoding", "referrerpolicy"],
    th: ["scope", "colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    "*": ["id", "class"],
  },
  allowedClasses: { "*": ["callout", "ct", "note", "warning", "tip", "hint", "summary-card"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href || "";
      const external = /^https?:\/\//i.test(href);
      const rel = new Set((attribs.rel || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      if (external) rel.add("nofollow");
      return {
        tagName: "a",
        attribs: {
          ...attribs,
          rel: [...rel].join(" "),
          ...(external && !attribs.target ? { target: "_blank" } : {}),
        },
      };
    },
    img: (tagName, attribs) => {
      const src = attribs.src || "";
      const safeSrc = /^https:\/\//i.test(src) || /^\/(?!\/)/.test(src) ? src : "";
      if (!safeSrc) return { tagName: "img", attribs: {} };
      const out = {
        src: safeSrc,
        alt: attribs.alt || "",
        loading: "lazy",
        decoding: "async",
        referrerpolicy: "no-referrer",
      };
      if (attribs.width) out.width = String(attribs.width).replace(/[^0-9]/g, "").slice(0, 5);
      if (attribs.height) out.height = String(attribs.height).replace(/[^0-9]/g, "").slice(0, 5);
      return { tagName: "img", attribs: out };
    },
  },
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
};

export function sanitizeContent(html) {
  return sanitizeHtml(String(html || ""), OPTIONS);
}

export function renderMarkdown(markdown) {
  const raw = marked.parse(String(markdown || ""), { async: false });
  return sanitizeContent(raw);
}

export function toHtml(content, format) {
  return String(format || "html") === "markdown" ? renderMarkdown(content) : sanitizeContent(content);
}
