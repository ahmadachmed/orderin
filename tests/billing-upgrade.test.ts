// @vitest-environment node
/**
 * Monetisation Phase 3 / T20 — POST /api/billing/upgrade integration tests
 * (issue #257). Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §4.1 / §8.3 / §10.
 *
 * Real DB + mocked admin session (createSession → next/headers mock) + stubbed
 * global fetch for the Duitku call. Covers: 401 without session, Payment
 * PENDING creation + paymentUrl return, idempotent re-click (same invoice,
 * no second Payment), Duitku error → 502 + EXPIRED trail, continuous period
 * for an active PRO tenant.
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "../src/lib/auth";
import { POST } from "../src/app/api/billing/upgrade/route";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";
import {
  buildExternalId,
  addDays,
  PRO_PRICE_IDR,
  BILLING_PERIOD_DAYS,
} from "../src/lib/billing";
import { _resetRateLimitsForTest } from "../src/lib/rate-limit";

process.env.DUITKU_MERCHANT_CODE = "D1234";
process.env.DUITKU_API_KEY = "test-api-key";
process.env.DUITKU_BASE_URL = "https://duitku.test/api/merchant/createInvoice";

const { tokenStore } = vi.hoisted(() => ({ tokenStore: { current: null as string | null } }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "headwaybrew_admin_session" && tokenStore.current
        ? { value: tokenStore.current }
        : undefined,
  }),
}));

const fixtures: TenantFixture[] = [];
let invoiceSeq = 0;

function stubInvoiceFetch(status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        invoiceSeq += 1;
        return status >= 200 && status < 300
          ? {
              merchantCode: "D1234",
              reference: `DUITKU_abc${invoiceSeq}`,
              paymentUrl: `https://app.duitku.com/payment/DUITKU_abc${invoiceSeq}`,
              amount: 99000,
              statusCode: "00",
              statusMessage: "Success",
            }
          : { statusCode: "01", statusMessage: "unauthorized" };
      },
    })
  );
}

function upgradeReq(): NextRequest {
  return new NextRequest("http://localhost/api/billing/upgrade", { method: "POST" });
}

async function paymentsFor(tenantId: string) {
  return prisma.payment.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
}

/** Each test starts with a clean Payment slate for its fixture. */
async function cleanPayments(tenantId: string) {
  await prisma.payment.deleteMany({ where: { tenantId } });
}

beforeAll(async () => {
  fixtures.push(await setupTenant());
  fixtures.push(await setupTenant());
});

beforeEach(() => _resetRateLimitsForTest());

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("auth", () => {
  it("returns 401 without an admin session", async () => {
    tokenStore.current = null;
    const res = await POST(upgradeReq());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/billing/upgrade", () => {
  it("creates a PENDING Payment and returns the Duitku paymentUrl", async () => {
    tokenStore.current = createSession(fixtures[0].tenantId, fixtures[0].adminId);
    await cleanPayments(fixtures[0].tenantId);
    stubInvoiceFetch();

    const res = await POST(upgradeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoiceUrl).toMatch(/^https:\/\/app\.duitku\.com\/payment\/DUITKU_abc\d+$/);
    expect(body.paymentId).toBeTruthy();

    const payments = await paymentsFor(fixtures[0].tenantId);
    expect(payments).toHaveLength(1);
    const p = payments[0];
    expect(p.status).toBe("PENDING");
    expect(p.gatewayReference).toMatch(/^DUITKU_abc\d+$/);
    expect(Number(p.amount)).toBe(PRO_PRICE_IDR);
    expect(p.externalId).toBe(buildExternalId(fixtures[0].tenantId, p.periodStart));
    expect(p.periodEnd.getTime() - p.periodStart.getTime()).toBe(BILLING_PERIOD_DAYS * 86_400_000);

    // Duitku payload: paymentAmount 99000 + expiryPeriod 4320.
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.paymentAmount).toBe(99000);
    expect(payload.expiryPeriod).toBe(4320);
    expect(payload.merchantOrderId).toBe(p.externalId);
    expect(payload.customerVaName).toBe("T7 Test Shop");
  });

  it("second click is idempotent: same invoiceUrl, still one Payment", async () => {
    tokenStore.current = createSession(fixtures[0].tenantId, fixtures[0].adminId);
    await cleanPayments(fixtures[0].tenantId);
    stubInvoiceFetch();

    const first = await POST(upgradeReq());
    const firstBody = await first.json();
    const second = await POST(upgradeReq());
    const secondBody = await second.json();

    expect(secondBody.invoiceUrl).toBe(firstBody.invoiceUrl);
    expect(secondBody.paymentId).toBe(firstBody.paymentId);
    const payments = await paymentsFor(fixtures[0].tenantId);
    expect(payments).toHaveLength(1);
    // No second Duitku create call for the same period.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("Duitku error → 502 + Payment marked EXPIRED (retryable trail)", async () => {
    tokenStore.current = createSession(fixtures[1].tenantId, fixtures[1].adminId);
    await cleanPayments(fixtures[1].tenantId);
    stubInvoiceFetch(401);

    const res = await POST(upgradeReq());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("Duitku");

    const payments = await paymentsFor(fixtures[1].tenantId);
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("EXPIRED");
  });

  it("active PRO tenant pays for the NEXT continuous period (periodStart = planExpiresAt)", async () => {
    tokenStore.current = createSession(fixtures[1].tenantId, fixtures[1].adminId);
    await cleanPayments(fixtures[1].tenantId);
    stubInvoiceFetch();
    const expiry = addDays(new Date(), 12);
    await prisma.tenant.update({
      where: { id: fixtures[1].tenantId },
      data: { plan: "PRO", planExpiresAt: expiry },
    });

    const res = await POST(upgradeReq());
    expect(res.status).toBe(200);
    const payments = await paymentsFor(fixtures[1].tenantId);
    const p = payments[payments.length - 1];
    expect(p.periodStart.getTime()).toBe(expiry.getTime());
    expect(p.externalId).toBe(buildExternalId(fixtures[1].tenantId, expiry));

    await prisma.tenant.update({
      where: { id: fixtures[1].tenantId },
      data: { plan: "FREE", planExpiresAt: null },
    });
  });

  it("expired payment does not block a fresh invoice (retry path)", async () => {
    tokenStore.current = createSession(fixtures[1].tenantId, fixtures[1].adminId);
    await cleanPayments(fixtures[1].tenantId);
    stubInvoiceFetch();
    const periodStart = new Date();
    await prisma.payment.create({
      data: {
        tenantId: fixtures[1].tenantId,
        externalId: buildExternalId(fixtures[1].tenantId, periodStart),
        amount: PRO_PRICE_IDR,
        periodStart,
        periodEnd: addDays(periodStart, BILLING_PERIOD_DAYS),
        status: "EXPIRED",
      },
    });

    const res = await POST(upgradeReq());
    expect(res.status).toBe(200);
    const payments = await paymentsFor(fixtures[1].tenantId);
    const latest = payments[payments.length - 1];
    expect(latest.status).toBe("PENDING");
    expect(latest.gatewayReference).toMatch(/^DUITKU_abc\d+$/);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // fresh invoice issued
  });
});
