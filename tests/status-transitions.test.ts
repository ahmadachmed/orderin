// @vitest-environment node
/**
 * Order status state machine + payment gate — issue #8 critical path (PLAN §3.1).
 * Exercises the real PATCH /api/admin/orders/[orderId] handler against a live
 * Postgres with a mocked admin session cookie:
 *   pending → confirmed → brewing (PAID gate) → ready_for_pickup → picked_up
 * Plus invalid transitions, cancellation rules, ETA semantics on queue leave,
 * audit logs, and cross-tenant isolation of the admin route.
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "../src/lib/auth";
import { PATCH } from "../src/app/api/admin/orders/[orderId]/route";
import { setupTenant, cleanupTenant, createOrderDirect, type TenantFixture } from "./helpers";

// Mock next/headers so getSession() reads our token (hoisted before imports).
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

async function patchOrder(orderId: string, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ orderId }) });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("PATCH /api/admin/orders/[orderId] — happy path state machine", () => {
  let fx: TenantFixture;
  let orderId: string;
  beforeAll(async () => {
    fx = await setupTenant({ prepTimeBuffer: 5 });
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    orderId = order.id;
  });

  it("pending → confirmed", async () => {
    const res = await patchOrder(orderId, { status: "CONFIRMED" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CONFIRMED");
  });

  it("confirmed → brewing is refused while UNPAID (payment gate 409)", async () => {
    const res = await patchOrder(orderId, { status: "BREWING" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/PAID/);
  });

  it("mark PAID (with method), then confirmed → brewing succeeds", async () => {
    const paid = await patchOrder(orderId, { paymentStatus: "PAID", paymentMethod: "qris" });
    expect(paid.status).toBe(200);
    const paidBody = await paid.json();
    expect(paidBody.paymentStatus).toBe("PAID");
    expect(paidBody.paidAt).toBeTruthy();

    const brew = await patchOrder(orderId, { status: "BREWING" });
    expect(brew.status).toBe(200);
    expect((await brew.json()).status).toBe("BREWING");
  });

  it("brewing → ready_for_pickup sets etaSeconds 0", async () => {
    const res = await patchOrder(orderId, { status: "READY_FOR_PICKUP" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("READY_FOR_PICKUP");
    expect(body.etaSeconds).toBe(0);
  });

  it("ready_for_pickup → picked_up sets etaSeconds null", async () => {
    const res = await patchOrder(orderId, { status: "PICKED_UP" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("PICKED_UP");
    expect(body.etaSeconds).toBeNull();
  });

  it("terminal states refuse further transitions", async () => {
    const res = await patchOrder(orderId, { status: "BREWING" });
    expect(res.status).toBe(422);
  });

  it("appends a BARISTA audit log per status change", async () => {
    const logs = await prisma.orderStatusLog.findMany({ where: { orderId } });
    expect(logs.length).toBeGreaterThanOrEqual(5); // created + 4 transitions
    expect(logs.every((l) => l.actorType === "BARISTA")).toBe(true);
    expect(logs.some((l) => l.paymentStatus === "PAID")).toBe(true); // payment event logged
  });
});

describe("PATCH /api/admin/orders/[orderId] — invalid transitions", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("pending → brewing is invalid (422)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchOrder(order.id, { status: "BREWING" });
    expect(res.status).toBe(422);
  });

  it("pending → ready_for_pickup is invalid (422)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchOrder(order.id, { status: "READY_FOR_PICKUP" });
    expect(res.status).toBe(422);
  });

  it("confirmed → cancelled is invalid — cancel only from pending", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable, { status: "CONFIRMED" });
    const res = await patchOrder(order.id, { status: "CANCELLED" });
    expect(res.status).toBe(422);
  });

  it("pending → cancelled is allowed and sets etaSeconds null", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchOrder(order.id, { status: "CANCELLED" });
    expect(res.status).toBe(200);
    expect((await res.json()).etaSeconds).toBeNull();
  });

  it("same-status transition is refused (422)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable, { status: "CONFIRMED" });
    const res = await patchOrder(order.id, { status: "CONFIRMED" });
    expect(res.status).toBe(422);
  });

  it("invalid status value is refused (422)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchOrder(order.id, { status: "TELEPORTED" });
    expect(res.status).toBe(422);
  });
});

describe("PATCH /api/admin/orders/[orderId] — payment transitions", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("UNPAID → PAID stores paidAt + method; PAID → UNPAID clears them", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const paid = await patchOrder(order.id, { paymentStatus: "PAID", paymentMethod: "bank_transfer" });
    expect(paid.status).toBe(200);
    const paidBody = await paid.json();
    expect(paidBody.paymentStatus).toBe("PAID");
    expect(paidBody.paymentMethod).toBe("bank_transfer");
    expect(paidBody.paidAt).toBeTruthy();

    const un = await patchOrder(order.id, { paymentStatus: "UNPAID" });
    expect(un.status).toBe(200);
    const unBody = await un.json();
    expect(unBody.paymentStatus).toBe("UNPAID");
    expect(unBody.paidAt).toBeNull();
    expect(unBody.paymentMethod).toBeNull();
  });

  it("rejects invalid paymentStatus and paymentMethod values", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const bad = await patchOrder(order.id, { paymentStatus: "MAYBE" });
    expect(bad.status).toBe(400);
    const badMethod = await patchOrder(order.id, { paymentStatus: "PAID", paymentMethod: "gold" });
    expect(badMethod.status).toBe(400);
  });
});

describe("PATCH /api/admin/orders/[orderId] — auth & isolation", () => {
  it("returns 401 without a session", async () => {
    const fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = null;
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchOrder(order.id, { status: "CONFIRMED" });
    expect(res.status).toBe(401);
  });

  it("cannot touch another tenant's order (404)", async () => {
    const tenantA = await setupTenant();
    const tenantB = await setupTenant();
    fixtures.push(tenantA, tenantB);
    tokenStore.current = createSession(tenantB.tenantId, tenantB.adminId);
    const orderA = await createOrderDirect(tenantA.tenantId, tenantA.itemAvailable);
    const res = await patchOrder(orderA.id, { status: "CONFIRMED" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent order", async () => {
    const fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
    const res = await patchOrder("00000000-0000-4000-8000-000000000000", {
      status: "CONFIRMED",
    });
    expect(res.status).toBe(404);
  });
});

describe("ETA recalc when an order leaves the queue", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant({ prepTimeBuffer: 5 });
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("remaining orders' stored ETAs shrink after the front order finishes", async () => {
    // Two orders in queue. o1: 600s own; o2: 600+600 = 1200 + 300 buffer.
    const o1 = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const o2 = await createOrderDirect(fx.tenantId, fx.itemAvailable);

    // Simulate POST-time ETA (route sets it; direct create doesn't) — set now.
    await prisma.order.update({ where: { id: o1.id }, data: { etaSeconds: 900 } });
    await prisma.order.update({ where: { id: o2.id }, data: { etaSeconds: 1500 } });

    // Walk o1 through the full chain; READY_FOR_PICKUP leaves the queue and
    // triggers recalc → o2's stored ETA should shrink to own+buffer.
    expect((await patchOrder(o1.id, { status: "CONFIRMED" })).status).toBe(200);
    expect((await patchOrder(o1.id, { paymentStatus: "PAID", paymentMethod: "qris" })).status).toBe(200);
    expect((await patchOrder(o1.id, { status: "BREWING" })).status).toBe(200);
    const ready = await patchOrder(o1.id, { status: "READY_FOR_PICKUP" });
    expect(ready.status).toBe(200);
    expect((await ready.json()).etaSeconds).toBe(0);

    const o2After = await prisma.order.findUnique({ where: { id: o2.id } });
    expect(o2After?.etaSeconds).toBe(900); // 600 own + 300 buffer
  });
});
