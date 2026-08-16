/**
 * Order creation critical path — issue #8 (PLAN §9.1).
 * Exercises the real POST /api/order route handler against a live Postgres:
 * validation, tenant lookup, open/hours guards, order cap, menu validation,
 * FIFO ETA calculation, and default order state.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "../src/app/api/order/route";
import { PATCH as patchSettings } from "../src/app/api/admin/settings/route";
import { createSession } from "../src/lib/auth";
import { formatTimeInTimezone } from "../src/lib/time";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";

// Mock next/headers so getSession() reads our admin token (for settings PATCH).
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

async function patchTenantSettings(slug: string, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/admin/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return patchSettings(req);
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("POST /api/order — happy path", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant({ prepTimeBuffer: 5 }); // 5 min buffer
    fixtures.push(fx);
  });

  it("creates a PENDING/UNPAID order with correct FIFO ETA", async () => {
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Budi",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 2 }],
      paymentMethod: "qris",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.orderId).toBeTruthy();
    expect(body.status).toBe("PENDING");
    // queue empty → own prep only: 600s × 2 + buffer 5min = 1500s
    expect(body.etaSeconds).toBe(1500);

    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      include: { items: true, statusLogs: true },
    });
    expect(order?.tenantId).toBe(fx.tenantId);
    expect(order?.paymentStatus).toBe("UNPAID");
    expect(order?.paymentMethod).toBe("qris");
    expect(order?.etaCalculatedAt).not.toBeNull();
    expect(order?.items).toHaveLength(1);
    expect(Number(order?.items[0].unitPrice)).toBe(15000); // snapshot price
    expect(order?.statusLogs[0].status).toBe("PENDING");
    // T15 §2.2: order is auto-assigned to an OPEN sprint (auto-created on
    // the tenant's first order after the sprint migration).
    expect(order?.sprintId).toBeTruthy();
    const sprint = await prisma.sprint.findUnique({ where: { id: order!.sprintId! } });
    expect(sprint?.tenantId).toBe(fx.tenantId);
    expect(sprint?.status).toBe("OPEN");
  });

  it("second order's ETA includes the first order's prep (FIFO)", async () => {
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Sari",
      customerPhone: "0822",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // ahead: 600×2=1200 + own 600 + buffer 300 = 2100
    expect(body.etaSeconds).toBe(2100);
  });

  it("no paymentMethod defaults to null, still UNPAID", async () => {
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Andi",
      customerPhone: "0833",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const order = await prisma.order.findUnique({ where: { id: body.orderId } });
    expect(order?.paymentMethod).toBeNull();
    expect(order?.paymentStatus).toBe("UNPAID");
  });
});

describe("POST /api/order — validation & guards", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
  });

  it("rejects missing required fields", async () => {
    const res = await postOrder(fx.slug, { slug: fx.slug, customerName: "X" });
    expect(res.status).toBe(400);
  });

  it("rejects empty items[]", async () => {
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [],
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid paymentMethod", async () => {
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
      paymentMethod: "bitcoin",
    });
    expect(res.status).toBe(400);
  });

  it("rejects quantity 0 and quantity > 99", async () => {
    const bad = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 0 }],
    });
    expect(bad.status).toBe(400);
    const huge = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 100 }],
    });
    expect(huge.status).toBe(400);
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await postOrder("no-such-shop", {
      slug: "no-such-shop",
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(404);
  });

  it("rejects orders when closed: isOpen=false with EXPIRED override outside hours (schedule governs)", async () => {
    // openTime == closeTime → never within hours; override expired → the
    // schedule says closed, so the (forced-closed) toggle no longer matters.
    const closed = await setupTenant({
      isOpen: false,
      openTime: "12:00",
      closeTime: "12:00",
      isOpenOverrideUntil: new Date(Date.now() - 86_400_000).toISOString(),
    });
    fixtures.push(closed);
    const res = await postOrder(closed.slug, {
      slug: closed.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: closed.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(422);
  });

  it("rejects orders outside hours when isOpen=true but override EXPIRED (schedule governs)", async () => {
    // #207 v2: a force-open only lasts until the next boundary. With the
    // override expired and hours never in range, the order is refused.
    const night = await setupTenant({
      isOpen: true,
      openTime: "12:00",
      closeTime: "12:00",
      isOpenOverrideUntil: new Date(Date.now() - 86_400_000).toISOString(),
    });
    fixtures.push(night);
    const res = await postOrder(night.slug, {
      slug: night.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: night.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(422);
  });

  it("accepts orders outside hours while an OPEN override is active", async () => {
    const night = await setupTenant({
      isOpen: true,
      openTime: "12:00",
      closeTime: "12:00", // never within hours
      isOpenOverrideUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    fixtures.push(night);
    const res = await postOrder(night.slug, {
      slug: night.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: night.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
  });

  it("rejects orders inside hours while a CLOSED override is active", async () => {
    const closed = await setupTenant({
      isOpen: false,
      openTime: "00:00",
      closeTime: "23:59", // always within hours
      isOpenOverrideUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    fixtures.push(closed);
    const res = await postOrder(closed.slug, {
      slug: closed.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: closed.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(422);
  });

  it("rejects unavailable menu items", async () => {
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemUnavailable, quantity: 1 }],
    });
    expect(res.status).toBe(422);
  });

  it("rejects a foreign tenant's menuItemId (tenant isolation at creation)", async () => {
    const other = await setupTenant();
    fixtures.push(other);
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: other.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(422);
  });
});

describe("POST /api/order — order cap (429)", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant({ maxQueueSize: 1 });
    fixtures.push(fx);
  });

  it("accepts the first order, refuses the second with 429", async () => {
    const first = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "One",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(first.status).toBe(201);

    const second = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Two",
      customerPhone: "0822",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(second.status).toBe(429);
  });

  it("frees a slot when the queued order leaves the queue", async () => {
    // Move the pending order to PICKED_UP directly in the DB (out of queue).
    const queued = await prisma.order.findFirst({ where: { tenantId: fx.tenantId } });
    expect(queued).not.toBeNull();
    await prisma.order.update({
      where: { id: queued!.id },
      data: { status: "PICKED_UP", etaSeconds: null },
    });

    const again = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Three",
      customerPhone: "0833",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(again.status).toBe(201);
  });
});

describe("PATCH /api/admin/settings — SETTINGS-03 HH:mm validation", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("accepts valid HH:mm openTime/closeTime", async () => {
    const res = await patchTenantSettings(fx.slug, {
      openTime: "07:00",
      closeTime: "21:30",
    });
    expect(res.status).toBe(200);
  });

  it("rejects non-HH:mm openTime with 400 'must be HH:mm format'", async () => {
    const res = await patchTenantSettings(fx.slug, { openTime: "abc" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("must be HH:mm format");
  });

  it("rejects non-HH:mm closeTime with 400 'must be HH:mm format'", async () => {
    const res = await patchTenantSettings(fx.slug, { closeTime: "7:00" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("must be HH:mm format");
  });

  it("accepts semantically-odd but format-valid times (24:01 passes regex)", async () => {
    const res = await patchTenantSettings(fx.slug, { openTime: "24:01" });
    expect(res.status).toBe(200);
  });

  it("stores the UTC value sent by the settings form (local 15:00 Makassar → 07:00 UTC round-trip)", async () => {
    // The settings page converts local input → UTC before PATCHing; this
    // verifies the route persists that UTC value and that the display
    // conversion renders the original local time back.
    const res = await patchTenantSettings(fx.slug, {
      openTime: "07:00",
      closeTime: "21:00",
      timezone: "Asia/Makassar",
    });
    expect(res.status).toBe(200);
    const tenant = await prisma.tenant.findUnique({ where: { slug: fx.slug } });
    expect(tenant?.openTime).toBe("07:00");
    expect(tenant?.closeTime).toBe("21:00");
    expect(tenant?.timezone).toBe("Asia/Makassar");
    // Stored UTC renders back as the local time the admin entered.
    expect(formatTimeInTimezone(tenant?.openTime ?? "", "Asia/Makassar")).toBe("15:00");
    expect(formatTimeInTimezone(tenant?.closeTime ?? "", "Asia/Makassar")).toBe("05:00");
  });
});

// ── Monetisation Phase 0 / T4 — plan fields in settings API (issue #229) ────
// contactEmail is editable; plan, planExpiresAt, and isActive are read-only
// (rejected with 400). GET returns all four fields (already verified by T1's
// SETTINGS_SELECT). These tests exercise the PATCH-side enforcement.
describe("PATCH /api/admin/settings — T4 plan field enforcement", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("PATCH contactEmail with a valid string → 200, stored, returned", async () => {
    const res = await patchTenantSettings(fx.slug, {
      contactEmail: "billing@kopisenja.test",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contactEmail).toBe("billing@kopisenja.test");
    const tenant = await prisma.tenant.findUnique({ where: { slug: fx.slug } });
    expect(tenant?.contactEmail).toBe("billing@kopisenja.test");
  });

  it("PATCH contactEmail null → 200, clears the field", async () => {
    // Set first, then null clears it.
    await patchTenantSettings(fx.slug, { contactEmail: "temp@kopisenja.test" });
    const res = await patchTenantSettings(fx.slug, { contactEmail: null });
    expect(res.status).toBe(200);
    const tenant = await prisma.tenant.findUnique({ where: { slug: fx.slug } });
    expect(tenant?.contactEmail).toBeNull();
  });

  it("PATCH plan → 400 'plan is read-only'", async () => {
    const res = await patchTenantSettings(fx.slug, { plan: "PRO" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("plan is read-only");
    // Verify DB unchanged — still FREE (default)
    const tenant = await prisma.tenant.findUnique({ where: { slug: fx.slug } });
    expect(tenant?.plan).toBe("FREE");
  });

  it("PATCH isActive → 400 'isActive is read-only'", async () => {
    const res = await patchTenantSettings(fx.slug, { isActive: false });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("isActive is read-only");
    const tenant = await prisma.tenant.findUnique({ where: { slug: fx.slug } });
    expect(tenant?.isActive).toBe(true);
  });

  it("PATCH planExpiresAt → 400 'planExpiresAt is read-only'", async () => {
    const res = await patchTenantSettings(fx.slug, {
      planExpiresAt: new Date().toISOString(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("planExpiresAt is read-only");
  });
});

describe("POST /api/order — ORDER-07 duplicate menuItemId aggregation", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant({ prepTimeBuffer: 0 });
    fixtures.push(fx);
  });

  it("aggregates duplicate menuItemIds into a single OrderItem with summed quantity", async () => {
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Dedi",
      customerPhone: "0844",
      items: [
        { menuItemId: fx.itemAvailable, quantity: 2 },
        { menuItemId: fx.itemAvailable, quantity: 3 },
      ],
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      include: { items: true },
    });
    expect(order?.items).toHaveLength(1); // one row, not two
    expect(order?.items[0].menuItemId).toBe(fx.itemAvailable);
    expect(order?.items[0].quantity).toBe(5); // 2 + 3 summed
    // own prep 600s × 5 = 3000, buffer 0 → ETA 3000
    expect(body.etaSeconds).toBe(3000);
  });

  it("keeps distinct menuItemIds as separate OrderItems (no aggregation)", async () => {
    // Fresh tenant so FIFO queue is empty (previous test left an order behind).
    const fx2 = await setupTenant({ prepTimeBuffer: 0 });
    fixtures.push(fx2);
    // Second available item (prep 300s) for the distinct-id case.
    const itemB = await prisma.menuItem.create({
      data: { tenantId: fx2.tenantId, name: "Item C", price: 20000, prepTimeSeconds: 300, isAvailable: true },
    });
    const res = await postOrder(fx2.slug, {
      slug: fx2.slug,
      customerName: "Eka",
      customerPhone: "0855",
      items: [
        { menuItemId: fx2.itemAvailable, quantity: 1 },
        { menuItemId: itemB.id, quantity: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      include: { items: true },
    });
    expect(order?.items).toHaveLength(2); // two distinct rows, no aggregation
    const byItem = new Map(order!.items.map((i) => [i.menuItemId, i.quantity]));
    expect(byItem.get(fx2.itemAvailable)).toBe(1);
    expect(byItem.get(itemB.id)).toBe(1);
    // own prep 600 + 300 = 900, buffer 0 → ETA 900
    expect(body.etaSeconds).toBe(900);
  });
});

describe("POST /api/order — ORDER-10 concurrent queue-cap race", () => {
  const QUEUE = ["PENDING", "CONFIRMED", "BREWING"] as const;

  async function activeCount(tenantId: string): Promise<number> {
    return prisma.order.count({
      where: { tenantId, status: { in: [...QUEUE] } },
    });
  }

  it("two parallel POSTs at queue = max-1 → exactly one 201, one 429", async () => {
    const fx = await setupTenant({ maxQueueSize: 1, prepTimeBuffer: 0 });
    fixtures.push(fx);
    const body = {
      slug: fx.slug,
      customerName: "Rini",
      customerPhone: "0866",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    };

    const results = await Promise.allSettled([postOrder(fx.slug, body), postOrder(fx.slug, body)]);
    const statuses = results
      .map((r) => (r.status === "fulfilled" ? r.value.status : -1))
      .sort((a, b) => a - b);

    // The advisory lock serializes check-then-create: one request creates,
    // the other re-counts a full queue and gets 429. No overshoot.
    expect(statuses).toEqual([201, 429]);
    expect(await activeCount(fx.tenantId)).toBe(1);
  });

  it("locks are tenant-scoped — two tenants fill their queues concurrently", async () => {
    const fa = await setupTenant({ maxQueueSize: 1, prepTimeBuffer: 0 });
    const fb = await setupTenant({ maxQueueSize: 1, prepTimeBuffer: 0 });
    fixtures.push(fa, fb);
    const mk = (slug: string, itemId: string, name: string, phone: string) => ({
      slug,
      customerName: name,
      customerPhone: phone,
      items: [{ menuItemId: itemId, quantity: 1 }],
    });

    const results = await Promise.allSettled([
      postOrder(fa.slug, mk(fa.slug, fa.itemAvailable, "A1", "0901")),
      postOrder(fa.slug, mk(fa.slug, fa.itemAvailable, "A2", "0902")),
      postOrder(fb.slug, mk(fb.slug, fb.itemAvailable, "B1", "0903")),
      postOrder(fb.slug, mk(fb.slug, fb.itemAvailable, "B2", "0904")),
    ]);
    const statuses = results
      .map((r) => (r.status === "fulfilled" ? r.value.status : -1))
      .sort((a, b) => a - b);

    // Both tenants fill to cap at the same time — a global lock would be
    // a bottleneck; the tenant-scoped key must not block across tenants.
    expect(statuses).toEqual([201, 201, 429, 429]);
    expect(await activeCount(fa.tenantId)).toBe(1);
    expect(await activeCount(fb.tenantId)).toBe(1);
  });

  it("queue never exceeds maxQueueSize under repeated concurrent pressure", async () => {
    // 5 rounds × (max=2, 4 parallel POSTs). Without serialization the
    // check-then-create race would admit 3-4 orders; the lock caps at 2.
    for (let i = 0; i < 5; i++) {
      const fx = await setupTenant({ maxQueueSize: 2, prepTimeBuffer: 0 });
      fixtures.push(fx);
      const mk = (n: number) => ({
        slug: fx.slug,
        customerName: `P${i}-${n}`,
        customerPhone: `092${i}${n}`,
        items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
      });

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, (_, k) => postOrder(fx.slug, mk(k)))
      );
      const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : -1));

      expect(statuses.filter((s) => s === 201)).toHaveLength(2);
      expect(statuses.filter((s) => s === 429)).toHaveLength(2);
      expect(await activeCount(fx.tenantId)).toBe(2); // exactly maxQueueSize, never more
    }
  });
});

// ── Monetisation Phase 1 / T8 — isActive gate (403) + monthly order cap (429) ─
// issue #229: FREE > 300 orders/month → 429; isActive=false → 403; PRO → limitless.
describe("POST /api/order — T8 isActive gate (403)", () => {
  it("rejects orders for an inactive tenant with 403", async () => {
    const fx = await setupTenant({ isActive: false });
    fixtures.push(fx);
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Blocked",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("not active");
  });

  it("isActive gate fires before the open-hours check (403, not 422)", async () => {
    // Shop is also closed (hours never in range) — isActive must take priority.
    const fx = await setupTenant({
      isActive: false,
      openTime: "12:00",
      closeTime: "12:00",
    });
    fixtures.push(fx);
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Blocked",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(403);
  });

  it("active tenant with valid hours still works (regression)", async () => {
    const fx = await setupTenant({ isActive: true });
    fixtures.push(fx);
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Go",
      customerPhone: "0811",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/order — T8 monthly order cap (429)", () => {
  it("FREE plan: rejects with 429 once the monthly cap is exceeded", async () => {
    // Use a very small cap by pre-filling orders up to the FREE limit (300).
    // Rather than creating 300 orders, we set the tenant's createdAt back to
    // the start of the month and bulk-insert 300 orders directly, then verify
    // the 301st is refused. The test is still fast because we create orders
    // in bulk without going through the API.
    const fx = await setupTenant({ plan: "FREE" });
    fixtures.push(fx);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Bulk-create 300 orders directly in the DB (at the FREE cap).
    const orderData = Array.from({ length: 300 }, (_, i) => ({
      tenantId: fx.tenantId,
      customerName: `Cap-${i}`,
      customerPhone: "0811",
      createdAt: monthStart,
      // PICKED_UP keeps these out of the FIFO queue (queue-cap test would
      // otherwise fire 429 first) — they still count toward the monthly cap.
      status: "PICKED_UP",
      items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
    }));
    for (const data of orderData) {
      await prisma.order.create({ data: data as never });
    }

    // 301st order via API → 429
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Over Cap",
      customerPhone: "0822",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("Monthly order limit reached");
  });

  it("FREE plan: under the cap → order succeeds", async () => {
    const fx = await setupTenant({ plan: "FREE" });
    fixtures.push(fx);

    // 299 pre-existing orders → under the 300 cap, API order should succeed.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const orderData = Array.from({ length: 299 }, (_, i) => ({
      tenantId: fx.tenantId,
      customerName: `Under-${i}`,
      customerPhone: "0811",
      createdAt: monthStart,
      status: "PICKED_UP",
      items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
    }));
    for (const data of orderData) {
      await prisma.order.create({ data: data as never });
    }

    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Under Cap",
      customerPhone: "0822",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
  });

  it("PRO plan: no monthly cap — order succeeds even with 300+ orders", async () => {
    const fx = await setupTenant({ plan: "PRO" });
    fixtures.push(fx);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const orderData = Array.from({ length: 350 }, (_, i) => ({
      tenantId: fx.tenantId,
      customerName: `Pro-${i}`,
      customerPhone: "0811",
      createdAt: monthStart,
      status: "PICKED_UP",
      items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
    }));
    for (const data of orderData) {
      await prisma.order.create({ data: data as never });
    }

    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "Pro Unlimited",
      customerPhone: "0822",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
  });

  it("cap counts only the current calendar month (last month's orders don't count)", async () => {
    const fx = await setupTenant({ plan: "FREE" });
    fixtures.push(fx);

    // 300 orders from LAST month — should not count toward this month's cap.
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const orderData = Array.from({ length: 300 }, (_, i) => ({
      tenantId: fx.tenantId,
      customerName: `Last-${i}`,
      customerPhone: "0811",
      createdAt: lastMonth,
      status: "PICKED_UP",
      items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
    }));
    for (const data of orderData) {
      await prisma.order.create({ data: data as never });
    }

    // This month's first order → 201 (last month's 300 don't block it)
    const res = await postOrder(fx.slug, {
      slug: fx.slug,
      customerName: "New Month",
      customerPhone: "0822",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
  });
});
