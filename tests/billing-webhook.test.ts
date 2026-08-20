// @vitest-environment node
/**
 * Monetisation Phase 3 / T20 — POST /api/webhooks/xendit integration tests
 * (issue #257). Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §6.3 / §10.
 *
 * Live Postgres + real route handler (signature verification is exercised
 * for real — token comes from process.env.XENDIT_WEBHOOK_TOKEN, read lazily).
 * Covers: token rejection, paid activation (Payment → PAID, Tenant → PRO
 * with continuous expiry), duplicate delivery no-op, underpayment refusal,
 * expired marking, unknown-invoice ack.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "../src/app/api/webhooks/xendit/route";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";
import {
  buildExternalId,
  addDays,
  nextExpiry,
  PRO_PRICE_IDR,
  BILLING_PERIOD_DAYS,
} from "../src/lib/billing";
import { _resetRateLimitsForTest } from "../src/lib/rate-limit";

process.env.XENDIT_WEBHOOK_TOKEN = "test-webhook-token";

const fixtures: TenantFixture[] = [];
const DAY_MS = 86_400_000;

function webhookReq(payload: Record<string, unknown>, token?: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["x-callback-token"] = token ?? process.env.XENDIT_WEBHOOK_TOKEN!;
  return new NextRequest("http://localhost/api/webhooks/xendit", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

async function seedPayment(
  tenantId: string,
  opts: { status?: "PENDING" | "PAID" | "EXPIRED"; periodStart?: Date; xenditInvoiceId?: string } = {}
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
      xenditInvoiceId: opts.xenditInvoiceId ?? `xnd_inv_${Math.random().toString(36).slice(2, 12)}`,
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
  it("rejects a missing token with 401 and processes nothing", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(webhookReq({ id: payment.xenditInvoiceId, status: "PAID", amount: 99000 }, null));
    expect(res.status).toBe(401);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PENDING");
  });

  it("rejects a wrong token with 401", async () => {
    const res = await POST(webhookReq({ id: "inv_whatever", status: "PAID" }, "wrong-token"));
    expect(res.status).toBe(401);
  });
});

describe("invoice.paid", () => {
  it("activates PRO: Payment → PAID + Tenant plan=PRO, planExpiresAt ≈ now+30d", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(
      webhookReq({
        id: payment.xenditInvoiceId,
        external_id: payment.externalId,
        status: "PAID",
        amount: 99000,
        paid_at: "2026-08-20T10:00:00.000Z",
        payment_method: "QRIS",
      })
    );
    expect(res.status).toBe(200);

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAID");
    expect(p.paidAt?.toISOString()).toBe("2026-08-20T10:00:00.000Z");
    expect(p.paymentMethod).toBe("QRIS");

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
    const res = await POST(webhookReq({ id: payment.xenditInvoiceId, status: "PAID", amount: 99000 }));
    expect(res.status).toBe(200);
    const t = await tenantPlan(fx.tenantId);
    expect(Math.abs(t.planExpiresAt!.getTime() - (baseExpiry.getTime() + 30 * DAY_MS))).toBeLessThan(1000);
    // restore FREE for later tests
    await prisma.tenant.update({ where: { id: fx.tenantId }, data: { plan: "FREE", planExpiresAt: null } });
  });

  it("accepts amount as a string (Xendit may send number or string)", async () => {
    const fx = fixtures[1];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(webhookReq({ id: payment.xenditInvoiceId, status: "PAID", amount: "99000" }));
    expect(res.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAID");
    const t = await tenantPlan(fx.tenantId);
    expect(t.plan).toBe("PRO");
    await prisma.tenant.update({ where: { id: fx.tenantId }, data: { plan: "FREE", planExpiresAt: null } });
  });

  it("duplicate delivery is a 200 no-op (planExpiresAt unchanged)", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId, { status: "PAID" });
    const before = (await prisma.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } })).planExpiresAt;
    const res = await POST(webhookReq({ id: payment.xenditInvoiceId, status: "PAID", amount: 99000 }));
    expect(res.status).toBe(200);
    const after = (await prisma.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } })).planExpiresAt;
    expect(after).toEqual(before);
  });

  it("UNDERPAYMENT is refused: tenant stays FREE, payment stays PENDING", async () => {
    const fx = fixtures[1];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(webhookReq({ id: payment.xenditInvoiceId, status: "PAID", amount: 50000 }));
    expect(res.status).toBe(200); // ack, but never activate
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PENDING");
    const t = await tenantPlan(fx.tenantId);
    expect(t.plan).toBe("FREE");
  });

  it("missing amount in payload → refused (no activation)", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(webhookReq({ id: payment.xenditInvoiceId, status: "PAID" }));
    expect(res.status).toBe(200);
    const t = await tenantPlan(fx.tenantId);
    expect(t.plan).toBe("FREE");
  });

  it("unknown invoice id/external_id → 200 ack without error", async () => {
    const res = await POST(webhookReq({ id: "inv_nope", external_id: "pay_nope", status: "PAID", amount: 99000 }));
    expect(res.status).toBe(200);
  });
});

describe("invoice.expired", () => {
  it("marks a PENDING payment EXPIRED", async () => {
    const fx = fixtures[1];
    const payment = await seedPayment(fx.tenantId);
    const res = await POST(webhookReq({ id: payment.xenditInvoiceId, status: "EXPIRED" }));
    expect(res.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("EXPIRED");
  });

  it("is a no-op on an already-PAID payment", async () => {
    const fx = fixtures[0];
    const payment = await seedPayment(fx.tenantId, { status: "PAID" });
    const res = await POST(webhookReq({ id: payment.xenditInvoiceId, status: "EXPIRED" }));
    expect(res.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAID");
  });
});

describe("other events", () => {
  it("unknown status → 200 ack, nothing changes", async () => {
    const fx = fixtures[0];
    const res = await POST(webhookReq({ id: "inv_x", external_id: buildExternalId(fx.tenantId, new Date()), status: "PENDING" }));
    expect(res.status).toBe(200);
  });

  it("malformed JSON → 400", async () => {
    const req = new NextRequest("http://localhost/api/webhooks/xendit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-callback-token": "test-webhook-token" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
