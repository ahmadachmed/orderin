/**
 * Sprint board filtering — T15 (issue #29, PLAN §5.2).
 * Integration tests for GET /api/admin/orders after the T15 §2.2 change:
 * the board shows only orders from the tenant's OPEN sprint plus legacy
 * orders without a sprintId (pre-migration). Orders belonging to a CLOSED
 * sprint disappear from the board unless carried over into the new OPEN
 * sprint by a close.
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "../src/lib/auth";
import { GET as boardOrders } from "../src/app/api/admin/orders/route";
import { POST as postOrder } from "../src/app/api/order/route";
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

async function createOrderInSprint(
  tenantId: string,
  itemId: string,
  sprintId: string | null,
  opts: { status?: string } = {}
) {
  return prisma.order.create({
    data: {
      tenantId,
      customerName: "Board Customer",
      customerPhone: "081299887766",
      status: (opts.status ?? "PENDING") as never,
      paymentStatus: "UNPAID" as never,
      sprintId,
      items: { create: [{ menuItemId: itemId, quantity: 1, unitPrice: 15000 }] },
    },
  });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("GET /api/admin/orders — sprint board filtering", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("shows an order placed via POST /api/order (auto-assigned to the OPEN sprint)", async () => {
    const res = await postOrder(
      new NextRequest("http://localhost/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: fx.slug,
          customerName: "Board",
          customerPhone: "0811",
          items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
        }),
      })
    );
    expect(res.status).toBe(201);
    const created = await res.json();

    const board = await boardOrders();
    expect(board.status).toBe(200);
    const body = await board.json();
    const order = body.orders.find((o: { id: string }) => o.id === created.orderId);
    expect(order).toBeDefined();
    expect(order.status).toBe("PENDING");
  });

  it("shows legacy orders (sprintId = null) alongside OPEN-sprint orders", async () => {
    const open = await prisma.sprint.findFirst({
      where: { tenantId: fx.tenantId, status: "OPEN" },
    });
    const legacy = await createOrderInSprint(fx.tenantId, fx.itemAvailable, null);
    const openOrder = await createOrderInSprint(fx.tenantId, fx.itemAvailable, open!.id);

    const board = await boardOrders();
    const body = await board.json();
    const ids = body.orders.map((o: { id: string }) => o.id);
    expect(ids).toContain(legacy.id);
    expect(ids).toContain(openOrder.id);
  });

  it("hides orders belonging to a CLOSED sprint", async () => {
    const closedSprint = await prisma.sprint.create({
      data: {
        tenantId: fx.tenantId,
        startAt: new Date(),
        status: "CLOSED" as never,
        endAt: new Date(),
        closedAt: new Date(),
      },
    });
    const ghost = await createOrderInSprint(fx.tenantId, fx.itemAvailable, closedSprint.id);

    const board = await boardOrders();
    const body = await board.json();
    const ids = body.orders.map((o: { id: string }) => o.id);
    expect(ids).not.toContain(ghost.id);
  });

  it("shows carried-over orders in the new sprint after a close", async () => {
    // Fresh tenant: one OPEN sprint with a PENDING order, close it → the
    // order carries into the replacement sprint and stays on the board.
    const fx2 = await setupTenant();
    fixtures.push(fx2);
    const sprint = await prisma.sprint.create({
      data: { tenantId: fx2.tenantId, startAt: new Date(), status: "OPEN" as never },
    });
    const order = await createOrderInSprint(fx2.tenantId, fx2.itemAvailable, sprint.id);

    const { closeSprint } = await import("../src/lib/sprint");
    await closeSprint(fx2.tenantId, sprint.id, 0);

    const saved = tokenStore.current;
    tokenStore.current = createSession(fx2.tenantId, fx2.adminId);
    const board = await boardOrders();
    const body = await board.json();
    const ids = body.orders.map((o: { id: string }) => o.id);
    expect(ids).toContain(order.id);
    tokenStore.current = saved;
  });
});
