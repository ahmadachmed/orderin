/**
 * GET /api/billing/status — billing overview for the admin's tenant (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §8.2 / §8.3.
 *
 * Returns the plan, expiry, grace flag, and the tenant's latest payments —
 * consumed by the admin settings BillingCard.
 */
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAYMENT_SELECT = {
  id: true,
  gatewayReference: true,
  externalId: true,
  amount: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  paidAt: true,
  paymentMethod: true,
  invoiceUrl: true,
  createdAt: true,
} as const;

export async function GET() {
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { plan: true, planExpiresAt: true },
  });
  if (!tenant) return fail("Tenant not found", 404);

  const now = new Date();
  // PRO but past expiry = grace period (cron has not downgraded yet).
  const inGrace =
    tenant.plan === "PRO" &&
    tenant.planExpiresAt !== null &&
    tenant.planExpiresAt.getTime() < now.getTime();

  const latestPayments = await prisma.payment.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: PAYMENT_SELECT,
  });

  return ok({
    plan: tenant.plan,
    planExpiresAt: tenant.planExpiresAt,
    inGrace,
    latestPayments,
  });
}
