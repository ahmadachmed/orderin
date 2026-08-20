/**
 * POST /api/billing/upgrade — start a PRO subscription payment (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §4.1 / §8.3.
 *
 * Flow: create a Payment row PENDING → create a Xendit invoice → return the
 * hosted invoice_url (the client redirects there). Idempotent: an existing
 * PENDING invoice for the same period is returned as-is, so double-clicks
 * and cron/upgrade races never double-charge.
 */
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, clientIp } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { createInvoice, XenditError } from "@/lib/xendit";
import {
  PRO_PRICE_IDR,
  BILLING_PERIOD_DAYS,
  addDays,
  buildExternalId,
  firstPeriodStart,
} from "@/lib/billing";
import { checkRateLimit, ROUTE_RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(clientIp(req), "POST /api/billing/upgrade", ROUTE_RATE_LIMITS["POST /api/billing/upgrade"]);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { id: true, slug: true, plan: true, planExpiresAt: true, contactEmail: true },
  });
  if (!tenant) return fail("Tenant not found", 404);

  const now = new Date();
  // Continuous periods: an ACTIVE PRO tenant pays for the next period
  // starting at the current expiry; FREE / in-grace tenants start now.
  const periodStart =
    tenant.plan === "PRO" && tenant.planExpiresAt && tenant.planExpiresAt.getTime() > now.getTime()
      ? tenant.planExpiresAt
      : firstPeriodStart(now);
  const periodEnd = addDays(periodStart, BILLING_PERIOD_DAYS);

  // Idempotency: a live PENDING invoice (period still covering now) is
  // returned as-is — a re-click seconds later must never double-charge.
  // Keyed on the window (periodEnd > now), not exact periodStart, because
  // periodStart is computed from `now` per request and differs by ms.
  const pending = await prisma.payment.findFirst({
    where: { tenantId: tenant.id, status: "PENDING", periodEnd: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (pending && pending.invoiceUrl) {
    return ok({ invoiceUrl: pending.invoiceUrl, paymentId: pending.id });
  }

  let payment = pending;
  if (!payment) {
    const attempt =
      (await prisma.payment.count({ where: { tenantId: tenant.id, periodStart } })) + 1;
    payment = await prisma.payment.create({
      data: {
        tenantId: tenant.id,
        externalId: buildExternalId(tenant.id, periodStart, attempt),
        amount: PRO_PRICE_IDR,
        periodStart,
        periodEnd,
        status: "PENDING",
      },
    });
  }

  try {
    const invoice = await createInvoice({
      externalId: payment.externalId,
      amount: PRO_PRICE_IDR,
      description: `HeadwayBrew PRO — langganan 30 hari (${periodStart.toISOString()} s/d ${periodEnd.toISOString()})`,
      successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/admin/${tenant.slug}/settings?billing=success`,
      customerEmail: tenant.contactEmail,
    });
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { xenditInvoiceId: invoice.id, invoiceUrl: invoice.invoice_url, status: "PENDING" },
    });
    return ok({ invoiceUrl: invoice.invoice_url, paymentId: updated.id });
  } catch (err) {
    // Xendit refused (bad key / duplicate / rate limit / network). Mark the
    // row EXPIRED as an audit trail so a later retry issues a fresh
    // external_id for the same period. Underpayment/activation never happens
    // here — activation only comes from a verified webhook.
    await prisma.payment
      .update({ where: { id: payment.id }, data: { status: "EXPIRED" } })
      .catch(() => undefined);
    if (err instanceof XenditError) {
      console.error("xendit createInvoice failed:", err.status, err.code, err.message);
      return fail(`Xendit error (${err.code})`, 502);
    }
    console.error("billing upgrade error:", err);
    return fail("Internal server error", 500);
  }
}
