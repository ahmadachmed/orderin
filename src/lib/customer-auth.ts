/**
 * Customer session auth (T17 per hybrid plan): stateless HMAC-signed cookie.
 * Mirror of src/lib/auth.ts (admin) with a different cookie name, longer TTL,
 * and a customer payload carrying tenantSlug.
 * Payload: base64url(JSON {slug, customerId, tenantId, exp}) . base64url(HMAC-SHA256).
 * No DB sessions table, no extra deps.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "headwaybrew_customer_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SECRET = process.env.SESSION_SECRET ?? "headwaybrew-dev-insecure-secret-change-me";

// Same production guard as auth.ts: a missing or dev-default SESSION_SECRET
// means every customer session is forgeable. Refuse to boot instead.
if (process.env.NODE_ENV === "production") {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "headwaybrew-dev-insecure-secret-change-me") {
    throw new Error("[headwaybrew] SESSION_SECRET is missing or still the dev default");
  }
}

export interface CustomerSession {
  tenantId: string;
  customerId: string;
  tenantSlug: string; // encoded in cookie value: slug|customerId|exp
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createCustomerSession(tenantId: string, customerId: string, slug: string): string {
  const payload = Buffer.from(
    JSON.stringify({ slug, customerId, tenantId, exp: Date.now() + TTL_MS })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyCustomerSession(token: string | undefined | null): CustomerSession | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      slug?: string; customerId?: string; tenantId?: string; exp?: number;
    };
    if (!data.customerId || !data.tenantId || !data.slug) return null;
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { customerId: data.customerId, tenantId: data.tenantId, tenantSlug: data.slug };
  } catch {
    return null;
  }
}

/** Read + verify the customer session from the current request (route handler only). */
export async function getCustomerSession(): Promise<CustomerSession | null> {
  return verifyCustomerSession((await cookies()).get(COOKIE_NAME)?.value);
}

export function customerSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}

export function clearCustomerSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
