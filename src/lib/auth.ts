/**
 * Admin session auth (MVP per PLAN §5): stateless HMAC-signed cookie.
 * Payload: base64url(JSON {tenantId, adminId, exp}) . base64url(HMAC-SHA256).
 * No DB sessions table, no extra deps. Post-MVP: next-auth.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "headwaybrew_admin_session";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SECRET = process.env.SESSION_SECRET ?? "headwaybrew-dev-insecure-secret-change-me";

// SEC-05: fail fast in production — a missing or dev-default SESSION_SECRET
// means every admin session is forgeable. Refuse to boot instead of shipping
// a silently broken deployment.
if (process.env.NODE_ENV === "production") {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "headwaybrew-dev-insecure-secret-change-me") {
    throw new Error("[headwaybrew] SESSION_SECRET is missing or still the dev default — refusing to start in production");
  }
}

export interface AdminSession {
  tenantId: string;
  adminId: string;
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createSession(tenantId: string, adminId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ tenantId, adminId, exp: Date.now() + TTL_MS })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined | null): AdminSession | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      tenantId?: string;
      adminId?: string;
      exp?: number;
    };
    if (!data.tenantId || !data.adminId) return null;
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { tenantId: data.tenantId, adminId: data.adminId };
  } catch {
    return null;
  }
}

/** Read + verify the session from the current request (route handler only). */
export async function getSession(): Promise<AdminSession | null> {
  return verifySession((await cookies()).get(COOKIE_NAME)?.value);
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
