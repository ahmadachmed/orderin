/**
 * POST /api/admin/auth — admin login (username + password, PLAN §9.2).
 * Verifies credentials against TenantAdmin (scoped to the tenant from the
 * slug), then issues an HMAC-signed session cookie.
 */
import { NextRequest } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, readJson } from "@/lib/api";
import { verifyPassword } from "@/lib/password";
import { createSession, sessionCookie } from "@/lib/auth";

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
