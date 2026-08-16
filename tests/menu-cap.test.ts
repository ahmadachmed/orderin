// @vitest-environment node
/**
 * T7 (issue #229) — Menu item cap enforcement integration tests.
 *
 * Verifies POST /api/admin/menu enforces the per-plan menu item cap:
 * - FREE: 25 items max → 26th create returns 402 Payment Required
 * - PRO:  unlimited → no 402 even past 25 items
 * - Under the cap (both plans): create succeeds (201)
 *
 * Pattern: live Postgres + mocked admin session cookie (same as
 * sprint-api.test.ts / status-transitions.test.ts). Uses setupTenant
 * with plan option, bulk-seeds menu items via the raw client, then
 * calls the POST handler directly.
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "../src/lib/auth";
import { POST as createMenuItem } from "../src/app/api/admin/menu/route";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";

// Mock next/headers so getSession() reads our admin token.
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

/** Build a NextRequest with JSON body for POST handler. */
function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/menu", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Bulk-insert N menu items for a tenant via the raw client (bypasses cap). */
async function seedMenuItems(tenantId: string, count: number): Promise<void> {
  const items = Array.from({ length: count }, (_, i) => ({
    tenantId,
    name: `Seed Item ${i + 1}`,
    price: 10000 + i,
  }));
  await prisma.menuItem.createMany({ data: items });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("POST /api/admin/menu — T7 menu cap enforcement (issue #229)", () => {
  describe("FREE plan (cap: 25)", () => {
    let fx: TenantFixture;

    beforeAll(async () => {
      fx = await setupTenant({ plan: "FREE" });
      fixtures.push(fx);
      tokenStore.current = createSession(fx.tenantId, fx.adminId);
    });

    it("creates an item when under the cap (201)", async () => {
      // setupTenant seeds 2 items, so we're at 2/25.
      const res = await createMenuItem(postReq({ name: "Es Kopi Susu", price: 18000 }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Es Kopi Susu");
      expect(Number(body.price)).toBe(18000);
    });

    it("allows create up to the cap boundary (25 items)", async () => {
      // setupTenant seeds 2, previous test added 1 → 3/25. Seed 21 more → 24/25.
      await seedMenuItems(fx.tenantId, 21);
      const res = await createMenuItem(postReq({ name: "Boundary Item", price: 25000 }));
      expect(res.status).toBe(201);
    });

    it("rejects create when at cap with 402 Payment Required", async () => {
      // Now at 25/25 — the next create must be refused.
      const res = await createMenuItem(postReq({ name: "Over Cap", price: 30000 }));
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.error).toMatch(/menu item limit/i);
      expect(body.error).toMatch(/25/);
    });

    it("does not insert the item when rejected", async () => {
      const countBefore = await prisma.menuItem.count({ where: { tenantId: fx.tenantId } });
      await createMenuItem(postReq({ name: "Should Not Exist", price: 99999 }));
      const countAfter = await prisma.menuItem.count({ where: { tenantId: fx.tenantId } });
      expect(countAfter).toBe(countBefore);
    });
  });

  describe("PRO plan (unlimited)", () => {
    let fx: TenantFixture;

    beforeAll(async () => {
      fx = await setupTenant({ plan: "PRO" });
      fixtures.push(fx);
      tokenStore.current = createSession(fx.tenantId, fx.adminId);
    });

    it("creates items past the FREE cap without 402", async () => {
      // Seed 25 items (the FREE cap) then create one more — should succeed.
      await seedMenuItems(fx.tenantId, 25);
      const res = await createMenuItem(postReq({ name: "PRO Item #26", price: 50000 }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("PRO Item #26");
    });

    it("creates many items well past 25 (no cap hit)", async () => {
      // Already at 27 (25 seeded + 2 from setupTenant + 1 from prev test).
      // Create 5 more — all should succeed.
      for (let i = 0; i < 5; i++) {
        const res = await createMenuItem(postReq({ name: `PRO Extra ${i}`, price: 10000 + i }));
        expect(res.status).toBe(201);
      }
    });
  });

  describe("auth guard", () => {
    it("returns 401 without a session", async () => {
      tokenStore.current = null;
      const res = await createMenuItem(postReq({ name: "No Auth", price: 1000 }));
      expect(res.status).toBe(401);
    });
  });
});
