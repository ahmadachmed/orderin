/**
 * POST /api/customer/register — T17-2 (issue #55): customer self-registration
 * for an order-status account. Creates a Customer in the tenant's schema,
 * then issues an HMAC-signed customer session cookie (auto-login).
 * Rate limited (3/min per IP) — config in src/lib/rate-limit.ts; the Edge
 * middleware enforces it before this handler runs, the inline check below
 * is a second line of defense for direct handler calls.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, readJson } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/password";
import { createCustomerSession, customerSessionCookie } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(ip, "POST /api/customer/register");
  if (!rl.ok) {
    return ok(
      { error: "Too many requests", retryAfterSec: rl.retryAfterSec },
      429
    );
  }

  const body = await readJson(req);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

  if (!name || !phone || !password || !slug) {
    return fail("name, phone, password, slug are required", 400);
  }
  if (password.length < 6) {
    return fail("Password minimal 6 karakter", 400);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return fail("Tenant not found", 404);

  const db = scoped(tenant.id);

  // Check duplicate phone in this tenant
  const existing = await db.customer.findFirst({ where: { phone } });
  if (existing) return fail("Nomor HP sudah terdaftar", 409);

  const passwordHash = hashPassword(password);
  const customer = await db.customer.create({
    data: {
      name,
      phone,
      passwordHash,
    } as unknown as Parameters<typeof prisma.customer.create>[0]["data"],
  });

  // Issue session cookie immediately (auto-login after register)
  const token = createCustomerSession(tenant.id, customer.id, slug);
  const res = NextResponse.json(
    { ok: true, customerId: customer.id, name: customer.name },
    { status: 201 }
  );
  res.headers.append("Set-Cookie", customerSessionCookie(token));
  return res;
}
