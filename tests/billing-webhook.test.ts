// @vitest-environment node
/**
 * Monetisation Phase 3 / T21 — POST /api/webhooks/duitku integration tests
 * (issue #257). Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §6.3 / §10.
 *
 * Live Postgres + real route handler (signature verification is exercised
 * for real — the callback `signature` form field is computed with the same
 * DUITKU_API_KEY the route reads, lazily). Callbacks are form POSTs
 * (application/x-www-form-urlencoded), NOT JSON.
 *
 * Covers: signature rejection (401), paid activation (Payment → PAID,
 * Tenant → PRO with continuous expiry), duplicate delivery no-op, underpayment
 * refusal, failed/expired marking, unknown-invoice ack, always-200.
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "../src/app/api/webhooks/duitku/route";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";
import {
  buildExternalId,
  addDays,
  nextExpiry,
  PRO_PRICE_IDR,
  BILLING_PERIOD_DAYS,
} from "../src/lib/billing";
import { _resetRateLimitsForTest } from "../src/lib/rate-limit";

const MERCHANT = "D1234";
const API_KEY = "test-api-key-abc";
process.env.DUITKU_MERCHANT_CODE = MERCHANT;
process.env.DUITKU_API_KEY = API_KEY;

const fixtures: TenantFixture[] = [];
const DAY_MS = 86_400_000;

function callbackSignature(merchantCode: string, amount: string, merchantOrderId: string): string {
  return createHmac("sha256", API_KEY)
    .update(`${merchantCode}${amount}${merchantOrderId}`)
    .digest("hex");
}

/** Build a signed form-POST callback (signature auto-computed unless opts.sign === false). */
function callbackReq(
  fields: Record<string, string>,
  opts: { sign?: boolean; signature?: string } = {}
): NextRequest {
  const params = new URLSearchParams(fields);
  if (opts.sign !== false) {
    params.set("signature", opts.signature ?? callbackSignature(fields.merchantCode, fields.amount, fields.merchantOrderId));
  }
  return new NextRequest("http://localhost/api/webhooks/duitku", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

function paidFields(merchantOrderId: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    merchantCode: MERCHANT,
    amount: "99000",
    merchantOrderId,
    resultCode: "00",
    reference: `DUITKU_${Math.random().toString(36).slice(2, 12)}`,
    paymentCode: "QRIS",
    paymentMethod: "QRIS",
    paymentDate: "2026-08-20 10:00:00",
    ...overrides,
  };
}

async function seedPayment(
  tenantId: string,
  opts: { status?: "PENDING" | "PAID" | "EXPIRED"; periodStart?: Date; gatewayReference?: string } = {}
) {
  const periodStart = opts.periodStart ?? new Date();
  return prisma.payment.create({
    data: {
      tenantId,
      externalId: buildExternalId(tenantId, periodStart),
      amount: PRO_PRICE_IDR,
      periodStart,
      periodEnd: addDays(periodStart, BILLING_PERIOD_DAYS),
      status: opts.status ?? "PENDING",
      gatewayReference: opts.gatewayReference ?? `DUITKU_${Math.random().toString(36).slice(2, 12)}`,
    },
  });
}

async function tenantPlan(tenantId: string) {
  return prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { plan: true, planExpiresAt: true },
  });
}

beforeAll(async () => {
  fixtures.push(await setupTenant());
  fixtures.push(await setupTenant());
});

beforeEach(async () => {
  _resetRateLimitsForTest();
  // Isolation: fixtures start FREE — paid-activation tests opt into PRO
  // explicitly, so plan-state assertions never see a previous test's residue.
  for (const f of fixtures) {
    await prisma.tenant.update({
      where: { id: f.tenantId },
      data: { plan: "FREE", planExpiresAt: null },
    });
  }
});

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("signature verification", () => {
  it("rejects a missing signature with 401 and processes nothing", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(callbackReq(paidFields(payment.externalId), { sign: false }));
    expect(res.status).toBe(401);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PENDING");
  });

  it("rejects a wrong signature with 401", async () => {
    const res = await POST(
      callbackReq(paidFields("pay_whatever"), { sign: false, signature: "a".repeat(64) })
    );
    expect(res.status).toBe(401);
  });

  it("rejects when the signature was computed over a different stringToSign order", async () => {
    // amount+merchantCode+merchantOrderId (wrong order) must NOT verify —
    // the callback stringToSign is merchantCode+amount+merchantOrderId.
    const bad = createHmac("sha256", API_KEY)
      .update(`99000${MERCHANT}pay_whatever`)
      .digest("hex");
    const res = await POST(callbackReq(paidFields("pay_whatever"), { sign: false, signature: bad }));
    expect(res.status).toBe(401);
  });

  it("rejects an empty body with 401 (no signature field)", async () => {
    const req = new NextRequest("http://localhost/api/webhooks/duitku", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect((await POST(req)).status).toBe(401);
  });
});

describe("callback paid (resultCode=00)", () => {
  it("activates PRO: Payment → PAID + Tenant plan=PRO, planExpiresAt ≈ now+30d", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(callbackReq(paidFields(payment.externalId)));
    expect(res.status).toBe(200);

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAID");
    expect(p.paymentMethod).toBe("QRIS");
    expect(p.paidAt).not.toBeNull();

    const t = await tenantPlan(fx.tenantId);
    expect(t.plan).toBe("PRO");
    const expected = nextExpiry(null, new Date()).getTime();
    expect(Math.abs(t.planExpiresAt!.getTime() - expected)).toBeLessThan(DAY_MS);
  });

  it("extends from the CURRENT expiry when renewing early (continuous periods)", async () => {
    const fx = fixtures[1];
    const baseExpiry = addDays(new Date(), 10);
    await prisma.tenant.update({ where: { id: fx.tenantId }, data: { plan: "PRO", planExpiresAt: baseExpiry } });
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(callbackReq(paidFields(payment.externalId)));
    expect(res.status).toBe(200);
    const t = await tenantPlan(fx.tenantId);
    expect(Math.abs(t.planExpiresAt!.getTime() - (baseExpiry.getTime() + 30 * DAY_MS))).toBeLessThan(1000);
    // restore FREE for later tests
    await prisma.tenant.update({ where: { id: fx.tenantId }, data: { plan: "FREE", planExpiresAt: null } });
  });

  it("accepts the amount as a decimal string (signed raw, e.g. '99000.00')", async () => {
    const fx = fixtures[1];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(callbackReq(paidFields(payment.externalId, { amount: "99000.00" })));
    expect(res.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAID");
    const t = await tenantPlan(fx.tenantId);
    expect(t.plan).toBe("PRO");
    await prisma.tenant.update({ where: { id: fx.tenantId }, data: { plan: "FREE", planExpiresAt: null } });
  });

  it("finds the payment by gatewayReference when merchantOrderId is unknown", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId);
    const ref = payment.gatewayReference!;
    const res = await POST(callbackReq(paidFields("pay_some_other_id", { reference: ref })));
    expect(res.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAID");
    await prisma.tenant.update({ where: { id: fx.tenantId }, data: { plan: "FREE", planExpiresAt: null } });
  });

  it("duplicate delivery is a 200 no-op (planExpiresAt unchanged)", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId, { status: "PAID" });
    const before = (await prisma.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } })).planExpiresAt;
    const res = await POST(callbackReq(paidFields(payment.externalId)));
    expect(res.status).toBe(200);
    const after = (await prisma.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } })).planExpiresAt;
    expect(after).toEqual(before);
  });

  it("UNDERPAYMENT is refused: tenant stays FREE, payment stays PENDING", async () => {
    const fx = fixtures[1];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(callbackReq(paidFields(payment.externalId, { amount: "50000" })));
    expect(res.status).toBe(200); // ack, but never activate
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PENDING");
    const t = await tenantPlan(fx.tenantId);
    expect(t.plan).toBe("FREE");
  });

  it("empty amount → 401 (signature cannot verify without the amount)", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId);
    // amount is part of the signed stringToSign — an empty amount means the
    // signature is unverifiable, so the callback is rejected before any
    // processing (signature is the authority).
    const res = await POST(callbackReq(paidFields(payment.externalId, { amount: "" })));
    expect(res.status).toBe(401);
    const t = await tenantPlan(fx.tenantId);
    expect(t.plan).toBe("FREE");
  });

  it("unknown merchantOrderId/reference → 200 ack without error", async () => {
    const res = await POST(callbackReq(paidFields("pay_nope", { reference: "DUITKU_nope" })));
    expect(res.status).toBe(200);
  });
});

describe("callback failed / other resultCodes", () => {
  it("marks a PENDING payment EXPIRED on resultCode=01", async () => {
    const fx = fixtures[1];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(callbackReq(paidFields(payment.externalId, { resultCode: "01", amount: "0" })));
    expect(res.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("EXPIRED");
  });

  it("is a no-op on an already-PAID payment", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId, { status: "PAID" });
    const res = await POST(callbackReq(paidFields(payment.externalId, { resultCode: "01", amount: "0" })));
    expect(res.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAID");
  });

  it("any non-00 resultCode marks a PENDING payment EXPIRED (plan §6.3)", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(callbackReq(paidFields(payment.externalId, { resultCode: "02" })));
    expect(res.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("EXPIRED");
  });
});
