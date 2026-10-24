import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: 128 * PARAMS.N * PARAMS.r * 2,
  });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored || "").split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = await scrypt(String(password), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generatePassword(bytes = 18) {
  return crypto.randomBytes(bytes).toString("base64url");
}

const COMMON = new Set([
  "12345678", "123456789", "1234567890", "password", "matkhau", "qwerty123",
  "admin123", "letmein", "welcome", "iloveyou",
]);

export function passwordProblem(password) {
  const value = String(password || "");
  if (value.length < 10) return "Mật khẩu cần tối thiểu 10 ký tự.";
  if (value.length > 200) return "Mật khẩu quá dài.";
  if (COMMON.has(value.toLowerCase())) return "Mật khẩu này quá phổ biến, hãy chọn mật khẩu khác.";
  if (/^[a-zA-Z]+$/.test(value) || /^\d+$/.test(value)) {
    return "Mật khẩu cần có cả chữ và số.";
  }
  return null;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
