/**
 * Sprint lifecycle — T15 (issue #29, PLAN §5.2).
 * Integration tests against a live Postgres for the core sprint state machine:
 * auto-open on first order, close → carry-over of active orders into a fresh
 * OPEN sprint, archival of PICKED_UP/CANCELLED orders, ETA recalculation on
 * carry-over, repeated closes, and legacy orders (sprintId = null) surviving
 * the whole flow untouched.
 *
 * The close path is exercised through closeSprint() directly (src/lib/sprint)
 * so the assertions run against the real DB writes; auto-open is exercised
 * through the real POST /api/order handler.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { closeSprint, getActiveSprint } from "../src/lib/sprint";
import { POST as postOrder } from "../src/app/api/order/route";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";

const fixtures: TenantFixture[] = [];

async function createOrderInSprint(
  tenantId: string,
  itemId: string,
  sprintId: string,
  opts: { status?: string; paymentStatus?: string; quantity?: number } = {}
) {
  return prisma.order.create({
    data: {
      tenantId,
      customerName: "Sprint Customer",
      customerPhone: "081299887766",
      status: (opts.status ?? "PENDING") as never,
      paymentStatus: (opts.paymentStatus ?? "UNPAID") as never,
      sprintId,
      items: {
        create: [
          {
            menuItemId: itemId,
            quantity: opts.quantity ?? 1,
            unitPrice: 15000,
          },
        ],
      },
    },
  });
}

async function createOpenSprint(tenantId: string) {
  return prisma.sprint.create({
    data: { tenantId, startAt: new Date(), status: "OPEN" as never },
  });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("sprint lifecycle — auto-open via POST /api/order", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant({ prepTimeBuffer: 5 });
    fixtures.push(fx);
  });

  it("auto-creates an OPEN sprint on the tenant's first order", async () => {
    const res = await postOrder(
      new NextRequest("http://localhost/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: fx.slug,
          customerName: "Budi",
          customerPhone: "0811",
          items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    const order = await prisma.order.findUnique({ where: { id: body.orderId } });
    expect(order?.sprintId).toBeTruthy();
    const sprint = await prisma.sprint.findUnique({ where: { id: order!.sprintId! } });
    expect(sprint?.tenantId).toBe(fx.tenantId);
    expect(sprint?.status).toBe("OPEN");
  });
});

describe("sprint lifecycle — close and carry-over", () => {
  let fx: TenantFixture;
  let sprintA: { id: string };
  let pendingOrder: { id: string };
  let readyOrder: { id: string };
  let pickedUpOrder: { id: string };
  let cancelledOrder: { id: string };

  beforeAll(async () => {
    fx = await setupTenant({ prepTimeBuffer: 5 });
    fixtures.push(fx);
    sprintA = await createOpenSprint(fx.tenantId);
    pendingOrder = await createOrderInSprint(fx.tenantId, fx.itemAvailable, sprintA.id, {
      status: "PENDING",
    });
    readyOrder = await createOrderInSprint(fx.tenantId, fx.itemAvailable, sprintA.id, {
      status: "READY_FOR_PICKUP",
    });
    pickedUpOrder = await createOrderInSprint(fx.tenantId, fx.itemAvailable, sprintA.id, {
      status: "PICKED_UP",
    });
    cancelledOrder = await createOrderInSprint(fx.tenantId, fx.itemAvailable, sprintA.id, {
      status: "CANCELLED",
    });
  });

  it("closes the sprint and returns carry-over/archived counts", async () => {
    const res = await closeSprint(fx.tenantId, sprintA.id, 5);
    expect(res.carriedOver).toBe(2); // PENDING + READY_FOR_PICKUP
    expect(res.archived).toBe(2); // PICKED_UP + CANCELLED

    const closed = await prisma.sprint.findUnique({ where: { id: sprintA.id } });
    expect(closed?.status).toBe("CLOSED");
    expect(closed?.endAt).not.toBeNull();
    expect(closed?.closedAt).not.toBeNull();
  });

  it("moves active orders to the new sprint, archives finished ones", async () => {
    const moved = await prisma.order.findMany({
      where: { id: { in: [pendingOrder.id, readyOrder.id] } },
    });
    for (const o of moved) {
      expect(o.sprintId).not.toBe(sprintA.id);
    }

    const archived = await prisma.order.findMany({
      where: { id: { in: [pickedUpOrder.id, cancelledOrder.id] } },
    });
    for (const o of archived) {
      expect(o.sprintId).toBe(sprintA.id);
    }
  });

  it("leaves exactly one OPEN sprint after close", async () => {
    const open = await prisma.sprint.findMany({
      where: { tenantId: fx.tenantId, status: "OPEN" },
    });
    expect(open).toHaveLength(1);
    const active = await getActiveSprint(fx.tenantId);
    expect(active?.id).toBe(open[0].id);
  });
});

describe("sprint lifecycle — ETA recalculation on carry-over", () => {
  let fx: TenantFixture;
  let sprintA: { id: string };
  let order1: { id: string };
  let order2: { id: string };

  beforeAll(async () => {
    fx = await setupTenant({ prepTimeBuffer: 5 }); // itemAvailable prep 600s
    fixtures.push(fx);
    sprintA = await createOpenSprint(fx.tenantId);
    // Two queued orders with deliberately stale ETAs — close must recompute.
    order1 = await createOrderInSprint(fx.tenantId, fx.itemAvailable, sprintA.id, {
      status: "PENDING",
      quantity: 1,
    });
    order2 = await createOrderInSprint(fx.tenantId, fx.itemAvailable, sprintA.id, {
      status: "PENDING",
      quantity: 1,
    });
    await prisma.order.update({
      where: { id: order1.id },
      data: { etaSeconds: 9999 },
    });
    await prisma.order.update({
      where: { id: order2.id },
      data: { etaSeconds: 9999 },
    });
  });

  it("recomputes FIFO ETAs for carried-over orders (buffer 5min = 300s)", async () => {
    const res = await closeSprint(fx.tenantId, sprintA.id, 5);
    expect(res.carriedOver).toBe(2);

    const o1 = await prisma.order.findUnique({ where: { id: order1.id } });
    const o2 = await prisma.order.findUnique({ where: { id: order2.id } });
    // o1: own prep 600 + buffer 300 = 900. o2: ahead 600 + own 600 + buffer 300 = 1500.
    expect(o1?.etaSeconds).toBe(900);
    expect(o2?.etaSeconds).toBe(1500);
    expect(o1?.etaCalculatedAt).not.toBeNull();
  });
});

describe("sprint lifecycle — repeated closes", () => {
  let fx: TenantFixture;

  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
  });

  it("closing the replacement sprint succeeds (no error on consecutive closes)", async () => {
    const a = await createOpenSprint(fx.tenantId);
    const first = await closeSprint(fx.tenantId, a.id, 0);
    expect(first.carriedOver).toBe(0);

    const second = await closeSprint(fx.tenantId, first.newSprintId, 0);
    expect(second.carriedOver).toBe(0);
    expect(second.archived).toBe(0);

    const closed = await prisma.sprint.findMany({
      where: { tenantId: fx.tenantId },
      orderBy: { startAt: "asc" },
    });
    expect(closed).toHaveLength(3); // a + replacement + replacement-of-replacement
    // Only the two closed ones are CLOSED; the final replacement stays OPEN.
    expect(closed.filter((s) => s.status === "CLOSED")).toHaveLength(2);
    expect(closed.filter((s) => s.status === "OPEN")).toHaveLength(1);
  });
});

describe("sprint lifecycle — legacy orders survive close", () => {
  let fx: TenantFixture;
  let legacyOrder: { id: string };

  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    // Order created before the sprint migration: no sprintId.
    legacyOrder = await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerName: "Legacy",
        customerPhone: "0899",
        status: "PENDING" as never,
        paymentStatus: "UNPAID" as never,
        items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
      },
    });
  });

  it("keeps legacy orders (sprintId = null) untouched through close", async () => {
    const sprint = await createOpenSprint(fx.tenantId);
    await closeSprint(fx.tenantId, sprint.id, 0);

    const legacy = await prisma.order.findUnique({ where: { id: legacyOrder.id } });
    expect(legacy?.sprintId).toBeNull();
    expect(legacy?.status).toBe("PENDING");
  });
});
