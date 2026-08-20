/**
 * POST /api/webhooks/duitku — receive Duitku Pop payment callbacks (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §6.3 / §9.
 *
 * Security model:
 * 1. HMAC-SHA256 callback signature verified constant-time
 *    (stringToSign = merchantCode + amount + merchantOrderId, DUITKU_API_KEY)
 *    → 401 on mismatch, nothing else runs.
 * 2. Per-IP rate limit as defense-in-depth (signature is the authority).
 * 3. Amount validation — a callback amount below Payment.amount NEVER
 *    activates PRO (underpayment attack / partial payment).
 * 4. Idempotent — unique merchantOrderId at create, status check +
 *    $transaction on paid, so Duitku retries / duplicate delivery can't
 *    double-activate.
 *
 * Callback = form POST (application/x-www-form-urlencoded), NOT JSON.
 * Routing is by `resultCode`: "00" → handlePaid, anything else → EXPIRED/no-op.
 * ALWAYS reply 200 OK — Duitku docs: "Return HTTP 200 OK"; anything else is
 * treated as failure and retried.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/api";
import { verifyCallbackSignature } from "@/lib/duitku";
import { nextExpiry } from "@/lib/billing";
import { checkRateLimit, ROUTE_RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface DuitkuCallback {
  merchantCode: string;
  /** RAW form value — signed exactly as Duitku sent it. */
  amount: string;
  /** = Payment.externalId (idempotency key). */
  merchantOrderId: string;
  /** Duitku transaction reference — matches Payment.gatewayReference. */
  reference: string | null;
  resultCode: string;
  paymentCode?: string | null;
  paymentMethod?: string | null;
  paymentDate?: string | null;
}

export async function POST(req: NextRequest) {
  // 1. Parse the form first — the signature itself is a form field.
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const callback: DuitkuCallback = {
    merchantCode: form.get("merchantCode") ?? "",
    amount: form.get("amount") ?? "",
    merchantOrderId: form.get("merchantOrderId") ?? "",
    reference: form.get("reference"),
    resultCode: form.get("resultCode") ?? "",
    paymentCode: form.get("paymentCode"),
    paymentMethod: form.get("paymentMethod"),
    paymentDate: form.get("paymentDate"),
  };

  // 2. Signature first — nothing else runs on a bad signature.
  if (!verifyCallbackSignature(callback.merchantCode, callback.amount, callback.merchantOrderId, form.get("signature"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 3. Defense-in-depth rate limit (per-IP).
  const rl = checkRateLimit(
    clientIp(req),
    "POST /api/webhooks/duitku",
    ROUTE_RATE_LIMITS["POST /api/webhooks/duitku"]
  );
  if (!rl.ok) {
    return new Response("Too Many Requests", { status: 429 });
  }

  // 4. Routing by resultCode ("00" = paid).
  if (callback.resultCode === "00") {
    await handlePaid(callback);
  } else {
    await handleFailed(callback);
  }

  // 5. Always ack 200 — Duitku retries on anything else.
  return new Response("OK", { status: 200 });
}

/** Locate the Payment by merchantOrderId (= externalId), then by reference. */
async function findPayment(callback: DuitkuCallback) {
  if (callback.merchantOrderId) {
    const byExternal = await prisma.payment.findUnique({
      where: { externalId: callback.merchantOrderId },
    });
    if (byExternal) return byExternal;
  }
  if (callback.reference) {
    return prisma.payment.findUnique({ where: { gatewayReference: callback.reference } });
  }
  return null;
}

async function handlePaid(callback: DuitkuCallback): Promise<void> {
  const payment = await findPayment(callback);
  if (!payment) {
    console.warn("[billing] duitku callback paid for unknown payment:", callback.merchantOrderId ?? callback.reference);
    return; // 200 upstream — don't make Duitku retry a callback we can't map
  }

  // Duplicate delivery (Duitku retries on non-200) — already activated.
  if (payment.status === "PAID") return;

  // 3. Amount validation — underpayment NEVER activates PRO.
  const paidAmount = Number(callback.amount);
  if (!Number.isFinite(paidAmount) || paidAmount < Number(payment.amount)) {
    console.error(
      `[billing] UNDERPAYMENT refused: payment ${payment.id} expects ${payment.amount}, callback sent ${callback.amount}`
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
        paidAt: callback.paymentDate ? new Date(callback.paymentDate) : now,
        paymentMethod: callback.paymentMethod ?? callback.paymentCode ?? null,
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

async function handleFailed(callback: DuitkuCallback): Promise<void> {
  const payment = await findPayment(callback);
  if (!payment) {
    console.warn("[billing] duitku callback failed for unknown payment:", callback.merchantOrderId ?? callback.reference);
    return;
  }
  // PAID payment receiving a late failure callback (or already handled) → no-op;
  // only PENDING expires.
  if (payment.status !== "PENDING") return;
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
  console.log(`[billing] payment ${payment.id} EXPIRED (resultCode ${callback.resultCode})`);
}
