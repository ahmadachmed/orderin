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
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";

// Mock next/headers so getSession() reads our admin token (for settings PATCH).
const { tokenStore } = vi.hoisted(() => ({ tokenStore: { current: null as string | null } }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "orderin_admin_session" && tokenStore.current
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

  it("rejects orders for a closed shop (isOpen=false)", async () => {
    const closed = await setupTenant({ isOpen: false });
    fixtures.push(closed);
    const res = await postOrder(closed.slug, {
      slug: closed.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: closed.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(422);
  });

  it("rejects orders outside operating hours", async () => {
    // openTime == closeTime → never within hours (12:00–12:00)
    const night = await setupTenant({ openTime: "12:00", closeTime: "12:00" });
    fixtures.push(night);
    const res = await postOrder(night.slug, {
      slug: night.slug,
      customerName: "X",
      customerPhone: "0811",
      items: [{ menuItemId: night.itemAvailable, quantity: 1 }],
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
