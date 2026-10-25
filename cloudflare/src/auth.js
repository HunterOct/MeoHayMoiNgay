import { scryptAsync } from "@noble/hashes/scrypt.js";
import { base64ToBytes, bytesToBase64, timingSafeEqual } from "./token.js";

const te = new TextEncoder();

export async function verifyScrypt(password, stored) {
  const [scheme, n, r, p, saltB64, hashB64] = String(stored || "").split("$");
  if (scheme !== "scrypt") return false;
  const salt = base64ToBytes(saltB64);
  const expected = base64ToBytes(hashB64);
  const actual = await scryptAsync(te.encode(String(password)), salt, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    dkLen: expected.length,
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return timingSafeEqual(actual, expected);
}

export async function hashScrypt(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await scryptAsync(te.encode(String(password)), salt, {
    N,
    r,
    p,
    dkLen: 64,
    maxmem: 128 * N * r * 2,
  });
  return ["scrypt", N, r, p, bytesToBase64(salt), bytesToBase64(key)].join("$");
}

export async function pbkdf2(password, salt, iterations = 600000) {
  const key = await crypto.subtle.importKey("raw", te.encode(String(password)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

