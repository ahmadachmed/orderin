/**
 * GET /api/tenant/[slug]/menu — public menu for a shop (available items only).
 * PLAN §9.1. Tenant lookup by slug is unscoped (slug is public); menu query
 * runs inside withTenant() so the extension injects the tenantId filter.
 */
import { NextRequest } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { effectiveOpen } from "@/lib/open";
import { isValidSlug } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Issue #252: reject malformed slugs before they reach the DB.
  if (!isValidSlug(slug)) return fail("Invalid slug format", 400);

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return fail("Tenant not found", 404);

  const items = await scoped(tenant.id).menuItem.findMany({
    where: { isAvailable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      imageUrl: true,
      prepTimeSeconds: true,
      sortOrder: true,
    },
  });

  return ok({
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      address: tenant.address,
      phone: tenant.phone,
      isOpen: effectiveOpen(tenant),
      openTime: tenant.openTime,
      closeTime: tenant.closeTime,
      timezone: tenant.timezone,
    },
    items,
  });
}
