/**
 * POST /api/register — self-service tenant onboarding (T8, PLAN §2.3).
 * Creates Tenant + TenantAdmin in a transaction, validates slug format +
 * uniqueness, then issues an HMAC-signed session cookie.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { prisma as db } from "@/lib/db";
import { ok, fail, readJson } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { createSession, sessionCookie } from "@/lib/auth";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body", 400);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug =
    typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name || !slug || !username || !password) {
    return fail("name, slug, username, password required", 400);
  }
  if (name.length > 100) return fail("Nama kedai maksimal 100 karakter", 400);
  if (slug.length < 3 || slug.length > 50) return fail("Slug harus 3–50 karakter", 400);
  if (!SLUG_RE.test(slug)) return fail("Slug hanya boleh huruf kecil, angka, dan dash", 400);
  if (username.length > 50) return fail("Username maksimal 50 karakter", 400);
  if (password.length < 6) return fail("Password minimal 6 karakter", 400);

  const existing = await db.tenant.findUnique({ where: { slug } });
  if (existing) return fail("Slug sudah dipakai", 409);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name, slug } });
      const admin = await tx.tenantAdmin.create({
        data: {
          tenantId: tenant.id,
          username,
          passwordHash: hashPassword(password),
        },
      });
      return { tenant, admin };
    });

    const token = createSession(result.tenant.id, result.admin.id);
    const res = ok(
      { ok: true, tenant: { slug: result.tenant.slug, name: result.tenant.name } },
      201
    );
    res.headers.set("Set-Cookie", sessionCookie(token));
    return res;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return fail("Slug atau username sudah dipakai", 409);
    }
    console.error("register error:", err);
    return fail("Internal server error", 500);
  }
}
