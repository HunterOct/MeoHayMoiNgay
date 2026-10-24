import fs from "node:fs";
import vm from "node:vm";

const ARRAY_NAMES = [
  "ARTICLES",
  "MORE_TIPS",
  "MORE_HOME",
  "MORE_HEALTH",
  "MORE_FOOD",
  "MORE_WIFI",
  "MORE_PHONE",
  "MORE_SECURITY",
];

const DECODE_KEY = "M3oHayMoiNgay2026";

function extractArrayLiteral(source, name) {
  const marker = `var ${name} = [`;
  const at = source.indexOf(marker);
  if (at === -1) return null;
  let i = source.indexOf("[", at);
  const start = i;
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = "";
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

export function decodeBody(encoded) {
  const bin = Buffer.from(String(encoded || ""), "base64");
  const key = DECODE_KEY;
  const out = Buffer.alloc(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin[i] ^ key.charCodeAt(i % key.length);
  }
  return out.toString("utf8");
}

export function loadLegacyArticles(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const all = [];
  for (const name of ARRAY_NAMES) {
    const literal = extractArrayLiteral(source, name);
    if (!literal) continue;
    const value = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 2000 });
    if (Array.isArray(value)) all.push(...value);
  }
  const seen = new Set();
  return all.filter((article) => {
    if (!article || !article.id || seen.has(article.id)) return false;
    seen.add(article.id);
    return true;
  });
}
