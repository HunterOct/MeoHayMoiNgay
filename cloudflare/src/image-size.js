const ascii = (bytes, start, end) =>
  String.fromCharCode(...bytes.slice(start, end));

export function parseSize(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") {
    if (bytes.length < 24) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (ascii(bytes, 0, 3) === "GIF") {
    if (bytes.length < 10) return null;
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    if (bytes.length < 32) return null;
    return webpSize(bytes, view, 12);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return jpegSize(bytes, view);
  }
  return null;
}

function webpSize(bytes, view, offset) {
  if (bytes.length < offset + 20) return null;
  const chunk = ascii(bytes, offset, offset + 4);
  if (chunk === "VP8X") {
    return {
      width: 1 + (bytes[offset + 12] | (bytes[offset + 13] << 8) | (bytes[offset + 14] << 16)),
      height: 1 + (bytes[offset + 15] | (bytes[offset + 16] << 8) | (bytes[offset + 17] << 16)),
    };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(offset + 9, true);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === "VP8 ") {
    return {
      width: view.getUint16(offset + 14, true) & 0x3fff,
      height: view.getUint16(offset + 16, true) & 0x3fff,
    };
  }
  return null;
}

function jpegSize(bytes, view) {
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    const len = view.getUint16(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return "image/png";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}
