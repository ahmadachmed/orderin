/**
 * POST /api/webhooks/xendit — receive Xendit invoice events (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §6.3 / §9.
 *
 * Security model:
 * 1. x-callback-token verified constant-time (XENDIT_WEBHOOK_TOKEN) → 401.
 * 2. Per-IP rate limit as defense-in-depth (signature is the authority).
 * 3. Amount validation — a webhook amount below Payment.amount NEVER
 *    activates PRO (underpayment attack / partial payment).
 * 4. Idempotent — unique external_id at create, status check + $transaction
 *    on paid, so Xendit's 6x retry / duplicate delivery can't double-activate.
 *
 * Routing is by invoice `status` (legacy v2 webhooks deliver the invoice
 * object itself): PAID → handlePaid, EXPIRED → handleExpired, else ack-200
 * without processing. Always ack quickly (200) — Xendit retries on timeout.
 *
 * NOTE: Payment is intentionally NOT in the tenant-scoping set (lib/prisma.ts)
 * — same rationale as Tenant: every op here is keyed by a unique id
 * (xenditInvoiceId / externalId / payment id) or by a session-derived
 * tenantId, never by request body.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/api";
import { verifyWebhookToken } from "@/lib/xendit";
import { nextExpiry } from "@/lib/billing";
import { checkRateLimit, ROUTE_RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface XenditWebhookPayload {
  /** Xendit invoice id (matches Payment.xenditInvoiceId). */
  id?: string;
  /** Our idempotency key (matches Payment.externalId). */
  external_id?: string;
  /** Invoice state: "PAID" | "EXPIRED" | ... */
  status?: string;
  /** Amount paid, in IDR. */
  amount?: number | string;
  paid_at?: string | null;
  payment_method?: string | null;
}

export async function POST(req: NextRequest) {
  // 1. Signature first — nothing else runs on a bad token.
  if (!verifyWebhookToken(req.headers.get("x-callback-token"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Defense-in-depth rate limit (per-IP).
  const rl = checkRateLimit(
    clientIp(req),
    "POST /api/webhooks/xendit",
    ROUTE_RATE_LIMITS["POST /api/webhooks/xendit"]
  );
  if (!rl.ok) {
    return new Response("Too Many Requests", { status: 429 });
  }

  let payload: XenditWebhookPayload;
  try {
    payload = (await req.json()) as XenditWebhookPayload;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return new Response("Bad Request", { status: 400 });
  }

  // 3. Event routing (legacy invoice webhook payloads carry the invoice object).
  const status = payload.status ?? "";
  if (status === "PAID") {
    await handlePaid(payload);
  } else if (status === "EXPIRED") {
    await handleExpired(payload);
  } else {
    // PENDING / other — nothing to do; ack so Xendit stops retrying.
  }

  // 4. Ack fast — Xendit retries on slow/timeout responses.
  return new Response("OK", { status: 200 });
}

/** Locate the Payment by Xendit invoice id, then by external_id. */
async function findPayment(payload: XenditWebhookPayload) {
  if (payload.id) {
    const byInvoice = await prisma.payment.findUnique({
      where: { xenditInvoiceId: payload.id },
    });
    if (byInvoice) return byInvoice;
  }
  if (payload.external_id) {
    return prisma.payment.findUnique({ where: { externalId: payload.external_id } });
  }
  return null;
}

async function handlePaid(payload: XenditWebhookPayload): Promise<void> {
  const payment = await findPayment(payload);
  if (!payment) {
    console.warn("[billing] invoice.paid for unknown payment:", payload.external_id ?? payload.id);
    return; // 200 upstream — don't make Xendit retry an invoice we can't map
  }

  // Duplicate delivery (Xendit retries up to 6x) — already activated.
  if (payment.status === "PAID") return;

  // 3. Amount validation — underpayment NEVER activates PRO.
  const paidAmount = Number(payload.amount);
  if (!Number.isFinite(paidAmount) || paidAmount < Number(payment.amount)) {
    console.error(
      `[billing] UNDERPAYMENT refused: payment ${payment.id} expects ${payment.amount}, webhook sent ${payload.amount}`
    );
    return; // 200 upstream (no retry) but no activation
  }

  // 4. Atomic activation: Payment → PAID + Tenant → PRO, continuous expiry.
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: payment.tenantId },
      select: { planExpiresAt: true },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        paidAt: payload.paid_at ? new Date(payload.paid_at) : now,
        paymentMethod: payload.payment_method ?? null,
      },
    });
    await tx.tenant.update({
      where: { id: payment.tenantId },
      data: {
        plan: "PRO",
        // Continuous renewal: max(current expiry, now) + 30 days (§4.2).
        planExpiresAt: nextExpiry(tenant?.planExpiresAt ?? null, now),
      },
    });
  });
  console.log(`[billing] payment ${payment.id} PAID — tenant ${payment.tenantId} activated PRO`);
}

async function handleExpired(payload: XenditWebhookPayload): Promise<void> {
  const payment = await findPayment(payload);
  if (!payment) {
    console.warn("[billing] invoice.expired for unknown payment:", payload.external_id ?? payload.id);
    return;
  }
  // PAID invoice expiring (or already handled) → no-op; only PENDING expires.
  if (payment.status !== "PENDING") return;
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
  console.log(`[billing] payment ${payment.id} EXPIRED`);
}
