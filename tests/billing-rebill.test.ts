// @vitest-environment node
/**
 * Monetisation Phase 3 / T20 — POST /api/cron/rebill integration tests
 * (issue #257). Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §7.2 / §7.3 / §10.
 *
 * Real DB + stubbed global fetch. Covers the grace boundary spec:
 *   - downgrade ONLY strictly after planExpiresAt + 3d (== stays PRO)
 *   - re-bill window: planExpiresAt <= now + 24h, idempotent per period
 *   - planExpiresAt = null (permanent PRO) → skipped entirely
 *   - FREE tenants → not touched
 *   - per-tenant errors isolated → summary { checked, invoiced, downgraded, errors }
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "../src/app/api/cron/rebill/route";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";
import {
  buildExternalId,
  addDays,
  PRO_PRICE_IDR,
  BILLING_PERIOD_DAYS,
} from "../src/lib/billing";
import { _resetRateLimitsForTest } from "../src/lib/rate-limit";

process.env.CRON_SECRET = "test-cron-secret";
process.env.DUITKU_MERCHANT_CODE = "D1234";
process.env.DUITKU_API_KEY = "test-api-key";
process.env.DUITKU_BASE_URL = "https://duitku.test/api/merchant/createInvoice";

const fixtures: TenantFixture[] = [];
const DAY_MS = 86_400_000;
const NOW = new Date();
let invoiceSeq = 0;

function stubInvoiceFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        invoiceSeq += 1;
        return {
          merchantCode: "D1234",
          reference: `DUITKU_CRON_${invoiceSeq}`,
          paymentUrl: `https://app.duitku.com/payment/DUITKU_CRON_${invoiceSeq}`,
          amount: 99000,
          statusCode: "00",
          statusMessage: "Success",
        };
      },
    })
  );
}

function cronReq(secret?: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (secret !== null) headers["x-cron-secret"] = secret ?? process.env.CRON_SECRET!;
  return new NextRequest("http://localhost/api/cron/rebill", {
    method: "POST",
    headers,
  });
}

async function setTenantPlan(tenantId: string, plan: "FREE" | "PRO", planExpiresAt: Date | null) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { plan, planExpiresAt } });
}

beforeAll(async () => {
  // One fixture per scenario to avoid cross-test interference.
  fixtures.push(await setupTenant()); // 0: re-bill window
  fixtures.push(await setupTenant()); // 1: permanent PRO (null expiry)
  fixtures.push(await setupTenant()); // 2: FREE
  fixtures.push(await setupTenant()); // 3: pending payment skip
  fixtures.push(await setupTenant()); // 4: downgrade (past grace)
  fixtures.push(await setupTenant()); // 5: downgrade boundary (exactly +3d)
  fixtures.push(await setupTenant()); // 6: far-future expiry
});

beforeEach(async () => {
  _resetRateLimitsForTest();
  // Isolation: every fixture starts FREE — tests opt into PRO explicitly, so
  // the cron query only ever sees the tenant(s) the current test set up.
  for (const f of fixtures) {
    await prisma.tenant.update({
      where: { id: f.tenantId },
      data: { plan: "FREE", planExpiresAt: null },
    });
  }
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("auth", () => {
  it("rejects a wrong/missing x-cron-secret with 401", async () => {
    expect((await POST(cronReq("wrong"))).status).toBe(401);
    expect((await POST(cronReq(null))).status).toBe(401); // no header at all
  });
});

describe("re-bill", () => {
  it("creates an invoice for a PRO tenant whose period ends within 24h", async () => {
    stubInvoiceFetch();
    const expiresAt = addDays(NOW, 1); // exactly +24h — window open (==)
    await setTenantPlan(fixtures[0].tenantId, "PRO", expiresAt);

    const res = await POST(cronReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoiced).toBe(1);
    expect(body.downgraded).toBe(0);

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.paymentAmount).toBe(99000);
    expect(payload.expiryPeriod).toBe(4320);
    expect(payload.paymentMethod).toBe("");
    expect(payload.customerVaName).toBe("T7 Test Shop");
    // Deterministic external id: periodStart == current expiry (continuous).
    expect(payload.merchantOrderId).toBe(buildExternalId(fixtures[0].tenantId, expiresAt));

    const payment = await prisma.payment.findFirst({
      where: { tenantId: fixtures[0].tenantId },
    });
    expect(payment).not.toBeNull();
    expect(payment!.status).toBe("PENDING");
    expect(payment!.externalId).toBe(buildExternalId(fixtures[0].tenantId, expiresAt));
    expect(payment!.gatewayReference).toBe("DUITKU_CRON_1");
    expect(payment!.periodStart.getTime()).toBe(expiresAt.getTime());
  });

  it("does NOT create a duplicate invoice when a PENDING payment exists for the period", async () => {
    stubInvoiceFetch();
    const expiresAt = addDays(NOW, 1);
    await setTenantPlan(fixtures[3].tenantId, "PRO", expiresAt);
    await prisma.payment.create({
      data: {
        tenantId: fixtures[3].tenantId,
        externalId: buildExternalId(fixtures[3].tenantId, expiresAt),
        amount: PRO_PRICE_IDR,
        periodStart: expiresAt,
        periodEnd: addDays(expiresAt, BILLING_PERIOD_DAYS),
        status: "PENDING",
        gatewayReference: "DUITKU_already_open",
        invoiceUrl: "https://app.duitku.com/payment/DUITKU_already_open",
      },
    });

    const res = await POST(cronReq());
    const body = await res.json();
    expect(body.invoiced).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const count = await prisma.payment.count({ where: { tenantId: fixtures[3].tenantId } });
    expect(count).toBe(1);
  });

  it("skips permanent PRO (planExpiresAt = null) — no invoice, no downgrade", async () => {
    stubInvoiceFetch();
    await setTenantPlan(fixtures[1].tenantId, "PRO", null);
    const res = await POST(cronReq());
    const body = await res.json();
    expect(body.checked).toBe(0); // excluded by the query itself
    expect(body.invoiced).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: fixtures[1].tenantId } });
    expect(t.plan).toBe("PRO");
    expect(t.planExpiresAt).toBeNull();
  });

  it("ignores FREE tenants", async () => {
    stubInvoiceFetch();
    const res = await POST(cronReq());
    const body = await res.json();
    expect(body.checked).toBe(0);
    expect(body.invoiced).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("does nothing for a PRO tenant with a far-future expiry (window closed)", async () => {
    stubInvoiceFetch();
    await setTenantPlan(fixtures[6].tenantId, "PRO", addDays(NOW, 30));
    const res = await POST(cronReq());
    const body = await res.json();
    expect(body.checked).toBe(1);
    expect(body.invoiced).toBe(0);
    expect(body.downgraded).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("does not downgrade a PRO tenant with a PAID payment when expiry is future", async () => {
    stubInvoiceFetch();
    const expiresAt = addDays(NOW, 5);
    await setTenantPlan(fixtures[6].tenantId, "PRO", expiresAt);
    await prisma.payment.create({
      data: {
        tenantId: fixtures[6].tenantId,
        externalId: buildExternalId(fixtures[6].tenantId, expiresAt),
        amount: PRO_PRICE_IDR,
        periodStart: expiresAt,
        periodEnd: addDays(expiresAt, BILLING_PERIOD_DAYS),
        status: "PAID",
        paidAt: new Date(),
        gatewayReference: "DUITKU_paid_1",
      },
    });
    const res = await POST(cronReq());
    const body = await res.json();
    expect(body.downgraded).toBe(0);
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: fixtures[6].tenantId } });
    expect(t.plan).toBe("PRO");
  });
});

describe("downgrade (grace boundary §7.3)", () => {
  it("downgrades to FREE when planExpiresAt + 3d < now", async () => {
    stubInvoiceFetch();
    // 1 minute PAST the boundary (robust against ms drift between test and route).
    await setTenantPlan(
      fixtures[4].tenantId,
      "PRO",
      new Date(Date.now() - 3 * DAY_MS - 60_000)
    );
    const res = await POST(cronReq());
    const body = await res.json();
    expect(body.downgraded).toBe(1);
    expect(body.invoiced).toBe(0);
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: fixtures[4].tenantId } });
    expect(t.plan).toBe("FREE");
    expect(t.planExpiresAt).toBeNull();
  });

  it("stays PRO when still at/before the +3d boundary", async () => {
    stubInvoiceFetch();
    // 1 minute BEFORE the boundary — grace not yet over (unit test
    // billing.test.ts pins the exact `==` case; ms drift between test and
    // route makes an exact boundary unrepresentable here).
    const expiresAt = new Date(Date.now() - 3 * DAY_MS + 60_000);
    await setTenantPlan(fixtures[5].tenantId, "PRO", expiresAt);
    const res = await POST(cronReq());
    const body = await res.json();
    expect(body.downgraded).toBe(0);
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: fixtures[5].tenantId } });
    expect(t.plan).toBe("PRO");
    // Window is open (expiry <= now + 24h) → a re-bill invoice is expected.
    expect(body.invoiced).toBe(1);
  });
});
