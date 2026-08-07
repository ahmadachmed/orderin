/**
 * POST /api/customer/login — T17-3 (issue #56): customer login for an
 * order-status account. Verifies phone + password against the tenant's
 * Customer row, then issues an HMAC-signed customer session cookie.
 * Rate limited (10/min per IP) — config in src/lib/rate-limit.ts; the Edge
 * middleware enforces it before this handler runs, the inline check below
 * is a second line of defense for direct handler calls.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, readJson } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyPassword } from "@/lib/password";
import { createCustomerSession, customerSessionCookie } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(ip, "POST /api/customer/login");
  if (!rl.ok) {
    return ok(
      { error: "Too many requests", retryAfterSec: rl.retryAfterSec },
      429
    );
  }

  const body = await readJson(req);
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

  if (!phone || !password || !slug) {
    return fail("phone, password, slug are required", 400);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return fail("Tenant not found", 404);

  const db = scoped(tenant.id);
  const customer = await db.customer.findFirst({ where: { phone } });
  if (!customer) return fail("Nomor HP atau password salah", 401);

  if (!verifyPassword(password, customer.passwordHash)) {
    return fail("Nomor HP atau password salah", 401);
  }

  const token = createCustomerSession(tenant.id, customer.id, slug);
  const res = NextResponse.json(
    { ok: true, customerId: customer.id, name: customer.name },
    { status: 200 }
  );
  res.headers.append("Set-Cookie", customerSessionCookie(token));
  return res;
}
