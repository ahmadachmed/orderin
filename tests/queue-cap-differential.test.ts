// @vitest-environment node
/**
 * T9 — Queue cap differential (issue #229).
 *
 * Verifies that POST /api/order enforces the plan-aware queue cap:
 *   FREE → hard-capped at 20 (even if tenant.maxQueueSize is higher)
 *   PRO  → capped at 100 (tenant.maxQueueSize honoured up to the ceiling)
 *
 * The cap is enforced via effectiveMaxQueueSize(tenant) + isQueueFull(),
 * replacing the old raw `queue.length >= tenant.maxQueueSize` comparison.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "../src/app/api/order/route";
import { effectiveMaxQueueSize } from "../src/lib/plan";
import { isQueueFull } from "../src/lib/queue";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";

// Mock next/headers (not needed for POST /api/order, but the settings
// PATCH tests in order-flow.test.ts use it; keep the pattern consistent
// in case future tests in this file need admin auth).
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

async function postOrder(slug: string, body: Record<string, unknown>) {
  const req = new NextRequest("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

// ─── Unit-level: effectiveMaxQueueSize + isQueueFull integration ─────────

describe("T9 — effectiveMaxQueueSize + isQueueFull (pure)", () => {
  it("FREE tenant with maxQueueSize 50 → capped to 20", () => {
    const cap = effectiveMaxQueueSize({ plan: "FREE", maxQueueSize: 50 });
    expect(cap).toBe(20);
    expect(isQueueFull(20, cap)).toBe(true);
    expect(isQueueFull(19, cap)).toBe(false);
  });

  it("PRO tenant with maxQueueSize 50 → 50 (under the 100 ceiling)", () => {
    const cap = effectiveMaxQueueSize({ plan: "PRO", maxQueueSize: 50 });
    expect(cap).toBe(50);
    expect(isQueueFull(50, cap)).toBe(true);
    expect(isQueueFull(49, cap)).toBe(false);
  });

  it("PRO tenant with maxQueueSize 200 → capped to 100", () => {
    const cap = effectiveMaxQueueSize({ plan: "PRO", maxQueueSize: 200 });
    expect(cap).toBe(100);
  });

  it("FREE tenant with maxQueueSize 20 → 20 (at ceiling, not over)", () => {
    const cap = effectiveMaxQueueSize({ plan: "FREE", maxQueueSize: 20 });
    expect(cap).toBe(20);
  });
});

// ─── Integration: POST /api/order enforces the plan-aware cap ───────────

describe("T9 — POST /api/order queue cap differential (issue #229)", () => {
  describe("FREE plan — hard-capped at 20", () => {
    let fx: TenantFixture;

    beforeAll(async () => {
      // FREE tenant with maxQueueSize set to 50 in the DB — the plan
      // ceiling (20) must override this.
      fx = await setupTenant({ plan: "FREE", maxQueueSize: 50, prepTimeBuffer: 0 });
      fixtures.push(fx);
    });

    it("effectiveMaxQueueSize returns 20 for this FREE tenant", async () => {
      const tenant = await prisma.tenant.findUnique({ where: { id: fx.tenantId } });
      expect(tenant?.plan).toBe("FREE");
      expect(tenant?.maxQueueSize).toBe(50); // DB column says 50...
      const cap = effectiveMaxQueueSize(tenant!);
      expect(cap).toBe(20); // ...but plan ceiling caps it at 20
    });

    it("accepts orders up to the 20 cap (FREE)", async () => {
      // Fill the queue to exactly 20 (the FREE ceiling).
      for (let i = 0; i < 20; i++) {
        const res = await postOrder(fx.slug, {
          slug: fx.slug,
          customerName: `FREE-${i}`,
          customerPhone: `0811${i}`,
          items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
        });
        expect(res.status).toBe(201);
      }

      // Verify 20 queued orders exist.
      const count = await prisma.order.count({
        where: { tenantId: fx.tenantId, status: { in: ["PENDING", "CONFIRMED", "BREWING"] } },
      });
      expect(count).toBe(20);
    });

    it("rejects the 21st order with 429 (FREE cap enforced, not 50)", async () => {
      const res = await postOrder(fx.slug, {
        slug: fx.slug,
        customerName: "FREE-overflow",
        customerPhone: "0899",
        items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
      });
      expect(res.status).toBe(429);

      // The queue should still be exactly 20 — no overshoot.
      const count = await prisma.order.count({
        where: { tenantId: fx.tenantId, status: { in: ["PENDING", "CONFIRMED", "BREWING"] } },
      });
      expect(count).toBe(20);
    });
  });

  describe("PRO plan — capped at 100 ceiling", () => {
    let fx: TenantFixture;

    beforeAll(async () => {
      // PRO tenant with maxQueueSize set to 50 — under the PRO ceiling
      // of 100, so the tenant's own value (50) is the effective cap.
      fx = await setupTenant({ plan: "PRO", maxQueueSize: 50, prepTimeBuffer: 0 });
      fixtures.push(fx);
    });

    it("effectiveMaxQueueSize returns 50 for this PRO tenant (under ceiling)", async () => {
      const tenant = await prisma.tenant.findUnique({ where: { id: fx.tenantId } });
      expect(tenant?.plan).toBe("PRO");
      expect(tenant?.maxQueueSize).toBe(50);
      const cap = effectiveMaxQueueSize(tenant!);
      expect(cap).toBe(50); // tenant value honoured, under the 100 ceiling
    });

    it("rejects order 51 with 429 (PRO tenant cap 50, not ceiling 100)", async () => {
      // Fill the queue to exactly 50 (the tenant's own cap).
      for (let i = 0; i < 50; i++) {
        const res = await postOrder(fx.slug, {
          slug: fx.slug,
          customerName: `PRO-${i}`,
          customerPhone: `0822${i}`,
          items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
        });
        expect(res.status).toBe(201);
      }

      // 51st order → 429 (tenant cap 50 is the effective cap, under 100).
      const res = await postOrder(fx.slug, {
        slug: fx.slug,
        customerName: "PRO-overflow",
        customerPhone: "0899",
        items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
      });
      expect(res.status).toBe(429);
    });
  });

  describe("PRO plan — ceiling 100 enforced when tenant.maxQueueSize > 100", () => {
    let fx: TenantFixture;

    beforeAll(async () => {
      // PRO tenant with maxQueueSize set to 200 — the plan ceiling
      // (100) must override this to 100.
      fx = await setupTenant({ plan: "PRO", maxQueueSize: 200, prepTimeBuffer: 0 });
      fixtures.push(fx);
    });

    it("effectiveMaxQueueSize returns 100 for this PRO tenant (ceiling enforced)", async () => {
      const tenant = await prisma.tenant.findUnique({ where: { id: fx.tenantId } });
      expect(tenant?.plan).toBe("PRO");
      expect(tenant?.maxQueueSize).toBe(200); // DB says 200...
      const cap = effectiveMaxQueueSize(tenant!);
      expect(cap).toBe(100); // ...but PRO ceiling caps at 100
    });
  });
});
