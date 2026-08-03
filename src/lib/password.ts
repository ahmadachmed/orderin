/**
 * Password hashing — scrypt via node:crypto (zero deps).
 * Format: scrypt:<salt-hex>:<hash-hex>
 * Importable from seed.ts / tests (no Next.js dependencies).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, KEY_LEN).toString("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}
