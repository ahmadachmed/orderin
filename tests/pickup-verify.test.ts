// @vitest-environment node
/**
 * T16-9 (docs/T17-hybrid-plan.md §T16-9): PICKUP-01 PIN verification gate on
 * the admin status transition READY_FOR_PICKUP → PICKED_UP. Real PATCH
 * handler + live Postgres, mocked admin session cookie:
 *   - wrong PIN → 403, order stays READY_FOR_PICKUP
 *   - correct PIN → 200, order becomes PICKED_UP
 *   - legacy orders (pickupCode="") skip the gate entirely
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "../src/lib/auth";
import { POST as postOrder } from "../src/app/api/order/route";
import { PATCH as patchOrder } from "../src/app/api/admin/orders/[orderId]/route";
import { setupTenant, cleanupTenant, createOrderDirect, type TenantFixture } from "./helpers";

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

async function postOrderReq(slug: string, phone: string, itemId: string) {
  const req = new NextRequest("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slug,
      customerName: "PIN Customer",
      customerPhone: phone,
      items: [{ menuItemId: itemId, quantity: 1 }],
    }),
  });
  return postOrder(req);
}

async function patchOrderReq(orderId: string, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return patchOrder(req, { params: Promise.resolve({ orderId }) });
}

/** Advance an order to READY_FOR_PICKUP (CONFIRMED → PAID → BREWING → READY). */
async function walkToReady(orderId: string) {
  expect((await patchOrderReq(orderId, { status: "CONFIRMED" })).status).toBe(200);
  expect(
    (await patchOrderReq(orderId, { paymentStatus: "PAID", paymentMethod: "cash" })).status
  ).toBe(200);
  expect((await patchOrderReq(orderId, { status: "BREWING" })).status).toBe(200);
  expect((await patchOrderReq(orderId, { status: "READY_FOR_PICKUP" })).status).toBe(200);
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("PATCH /api/admin/orders/[orderId] — PIN verification gate (PICKUP-01)", () => {
  let fx: TenantFixture;
  let itemId: string;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
    itemId = fx.itemAvailable;
  });

  it("rejects READY→PICKED_UP with a wrong PIN (403)", async () => {
    const created = await postOrderReq(fx.slug, "0814-1001", itemId);
    expect(created.status).toBe(201);
    const { orderId } = await created.json();
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.pickupCode).toMatch(/^[1-9]\d{3}$/);

    await walkToReady(orderId);

    const wrong = await patchOrderReq(orderId, { status: "PICKED_UP", pickupCode: "0000" });
    expect(wrong.status).toBe(403);
    const body = await wrong.json();
    expect(body.error).toContain("PIN");

    // Order must still be READY_FOR_PICKUP — the gate rejected the transition.
    const after = await prisma.order.findUnique({ where: { id: orderId } });
    expect(after?.status).toBe("READY_FOR_PICKUP");
    expect(after?.etaSeconds).toBe(0);
  });

  it("allows READY→PICKED_UP with the correct PIN (200)", async () => {
    const created = await postOrderReq(fx.slug, "0814-1002", itemId);
    expect(created.status).toBe(201);
    const { orderId } = await created.json();
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const realPin = order!.pickupCode;

    await walkToReady(orderId);

    const ok = await patchOrderReq(orderId, { status: "PICKED_UP", pickupCode: realPin });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.status).toBe("PICKED_UP");
    expect(body.etaSeconds).toBeNull();

    const after = await prisma.order.findUnique({ where: { id: orderId } });
    expect(after?.status).toBe("PICKED_UP");
  });

  it("rejects a missing PIN the same as a wrong one (403)", async () => {
    const created = await postOrderReq(fx.slug, "0814-1003", itemId);
    expect(created.status).toBe(201);
    const { orderId } = await created.json();
    await walkToReady(orderId);

    const noPin = await patchOrderReq(orderId, { status: "PICKED_UP" });
    expect(noPin.status).toBe(403);
  });

  it("skips the PIN gate for legacy orders with pickupCode=''", async () => {
    const order = await createOrderDirect(fx.tenantId, itemId, { status: "PENDING" });
    expect(order.pickupCode).toBe(""); // legacy row — no PIN generated

    await walkToReady(order.id);

    // No pickupCode in the body — legacy orders transition without one.
    const res = await patchOrderReq(order.id, { status: "PICKED_UP" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("PICKED_UP");
  });

  it("does not apply the PIN gate to non-PICKED_UP transitions", async () => {
    const created = await postOrderReq(fx.slug, "0814-1004", itemId);
    expect(created.status).toBe(201);
    const { orderId } = await created.json();

    // CONFIRMED with a garbage pickupCode field is ignored — gate only fires
    // on the READY_FOR_PICKUP → PICKED_UP transition.
    const res = await patchOrderReq(orderId, { status: "CONFIRMED", pickupCode: "nope" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("CONFIRMED");
  });
});
