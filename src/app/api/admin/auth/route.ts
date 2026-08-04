/**
 * POST /api/admin/auth — admin login (username + password, PLAN §9.2).
 * Verifies credentials against TenantAdmin (scoped to the tenant from the
 * slug), then issues an HMAC-signed session cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, readJson } from "@/lib/api";
import { verifyPassword } from "@/lib/password";
import { createSession, sessionCookie, clearSessionCookie, getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body", 400);

  const slug =
    (typeof body.tenantSlug === "string" ? body.tenantSlug : "") ||
    (typeof body.slug === "string" ? body.slug : "");
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!slug || !username || !password) return fail("slug, username, password required", 400);

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return fail("Invalid credentials", 401);

  // Scoped lookup: username is unique per tenant (PLAN §7.2 @@unique).
  const admin = await scoped(tenant.id).tenantAdmin.findFirst({ where: { username } });
  if (!admin || !verifyPassword(password, admin.passwordHash)) {
    return fail("Invalid credentials", 401);
  }

  const token = createSession(tenant.id, admin.id);
  const res = ok({ ok: true, tenant: { slug: tenant.slug, name: tenant.name } });
  res.headers.set("Set-Cookie", sessionCookie(token));
  return res;
}

/**
 * GET /api/admin/auth — lightweight session probe (LOGIN-01).
 * No DB query: just verifies the HMAC cookie. 200 {authenticated:true} when
 * the session is valid, 401 otherwise.
 */
export async function GET() {
  const session = getSession();
  if (!session) return fail("Unauthorized", 401);
  return ok({ authenticated: true });
}

/**
 * DELETE /api/admin/auth — logout (LOGIN-05). Clears the session cookie.
 * 204 No Content + Set-Cookie with Max-Age=0.
 */
export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}
