const encoder = new TextEncoder();

export function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function timingSafeEqual(a, b) {
  const left = a instanceof Uint8Array ? a : encoder.encode(String(a));
  const right = b instanceof Uint8Array ? b : encoder.encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
