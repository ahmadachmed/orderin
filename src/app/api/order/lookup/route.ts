/**
 * POST /api/order/lookup — CUST-02 (issue #53): find a customer's active
 * order by phone number. Used by the menu page banner to resume an order.
 * Rate limited (5/min per IP) — config in src/lib/rate-limit.ts; the Edge
 * middleware enforces it before this handler runs, the inline check below
 * is a second line of defense for direct handler calls.
 */
import { NextRequest } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, readJson } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { OrderStatus } from "@/generated/prisma/enums";
import { isValidSlug, PHONE_MAX, hasLengthAtMost } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set<OrderStatus>([
  "PENDING",
  "CONFIRMED",
  "BREWING",
  "READY_FOR_PICKUP",
]);

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(ip, "POST /api/order/lookup");
  if (!rl.ok) {
    return ok(
      { error: "Too many requests", retryAfterSec: rl.retryAfterSec },
      429
    );
  }

  const body = await readJson(req);
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

  if (!phone || !slug) {
    return fail("phone and slug are required", 400);
  }
  // Issue #252: format guards before any DB work.
  if (!isValidSlug(slug)) return fail("Invalid slug format", 400);
  if (!hasLengthAtMost(phone, PHONE_MAX))
    return fail(`phone maksimal ${PHONE_MAX} karakter`, 400);

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return fail("Tenant not found", 404);

  const order = await scoped(tenant.id).order.findFirst({
    where: {
      customerPhone: phone,
      status: { in: Array.from(ACTIVE_STATUSES) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, customerName: true, createdAt: true },
  });

  if (!order) return fail("No active order found for this phone", 404);

  return ok({ orderId: order.id, status: order.status, customerName: order.customerName });
}
