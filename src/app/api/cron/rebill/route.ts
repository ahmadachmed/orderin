/**
 * POST /api/cron/rebill — daily billing pass (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §7.
 *
 * Triggered by .github/workflows/rebill.yml (GitHub Actions — Vercel Hobby
 * has no Cron Jobs) with header `x-cron-secret` == CRON_SECRET (constant-time).
 *
 * One pass over PRO tenants with a finite expiry (planExpiresAt != null;
 * null = permanent PRO → skipped by the query itself):
 *   1. Downgrade: planExpiresAt + 3d STRICTLY < now → plan=FREE (grace ended).
 *   2. Re-bill: planExpiresAt <= now + 24h AND no PENDING payment for the
 *      next period → create a Xendit invoice (pay window == 72h == grace).
 *   3. Per-tenant errors are isolated — one failing tenant never kills the
 *      run. Response: { checked, invoiced, downgraded, errors }.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/api";
import { verifyCronSecret, createInvoice, XenditError } from "@/lib/xendit";
import {
  PRO_PRICE_IDR,
  BILLING_PERIOD_DAYS,
  addDays,
  buildExternalId,
  rebillPeriodStart,
  shouldDowngrade,
  shouldRebill,
} from "@/lib/billing";
import { checkRateLimit, ROUTE_RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Auth: x-cron-secret (constant-time). Never public.
  if (!verifyCronSecret(req.headers.get("x-cron-secret"))) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Defense-in-depth rate limit (per-IP).
  const rl = checkRateLimit(clientIp(req), "POST /api/cron/rebill", ROUTE_RATE_LIMITS["POST /api/cron/rebill"]);
  if (!rl.ok) {
    return new Response("Too Many Requests", { status: 429 });
  }

  // planExpiresAt != null → permanent PRO (demo tenants) never enters the pass.
  const tenants = await prisma.tenant.findMany({
    where: { plan: "PRO", planExpiresAt: { not: null } },
    select: { id: true, slug: true, planExpiresAt: true, contactEmail: true },
  });

  const now = new Date();
  let invoiced = 0;
  let downgraded = 0;
  let errors = 0;

  for (const tenant of tenants) {
    const expiresAt = tenant.planExpiresAt as Date; // non-null by query filter
    try {
      // 1. Grace ended → downgrade (boundary: strictly AFTER +3d).
      if (shouldDowngrade(expiresAt, now)) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { plan: "FREE", planExpiresAt: null },
        });
        downgraded += 1;
        console.log(`[billing] tenant ${tenant.id} downgraded FREE (grace ended ${expiresAt.toISOString()})`);
        continue;
      }

      // 2. Re-bill window: period ends within 24h (or is already in grace).
      if (!shouldRebill(expiresAt, now)) continue;

      // Idempotency: an open PENDING invoice for this period → nothing to do
      // (covers cron overlap runs; the same external_id would be rejected by
      // Xendit anyway).
      const periodStart = rebillPeriodStart(expiresAt);
      const pending = await prisma.payment.findFirst({
        where: { tenantId: tenant.id, periodStart, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (pending) continue;

      const attempt =
        (await prisma.payment.count({ where: { tenantId: tenant.id, periodStart } })) + 1;
      const externalId = buildExternalId(tenant.id, periodStart, attempt);
      const periodEnd = addDays(periodStart, BILLING_PERIOD_DAYS);
      const payment = await prisma.payment.create({
        data: {
          tenantId: tenant.id,
          externalId,
          amount: PRO_PRICE_IDR,
          periodStart,
          periodEnd,
          status: "PENDING",
        },
      });

      try {
        const invoice = await createInvoice({
          externalId,
          amount: PRO_PRICE_IDR,
          description: `HeadwayBrew PRO — langganan 30 hari (${periodStart.toISOString()} s/d ${periodEnd.toISOString()})`,
          successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/admin/${tenant.slug}/settings?billing=success`,
          customerEmail: tenant.contactEmail,
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { xenditInvoiceId: invoice.id, invoiceUrl: invoice.invoice_url },
        });
        invoiced += 1;
        console.log(`[billing] re-bill invoice ${invoice.id} for tenant ${tenant.id} (period ${periodStart.toISOString()})`);
      } catch (err) {
        // Xendit refused — mark the row EXPIRED (audit trail; a later run
        // re-issues with a fresh external_id attempt) and count the error.
        await prisma.payment
          .update({ where: { id: payment.id }, data: { status: "EXPIRED" } })
          .catch(() => undefined);
        throw err;
      }
    } catch (err) {
      errors += 1;
      console.error(`[billing] rebill error for tenant ${tenant.id}:`, err);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, checked: tenants.length, invoiced, downgraded, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
