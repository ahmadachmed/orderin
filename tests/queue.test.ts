// @vitest-environment node
/**
 * Queue & ETA integration tests — issue #6 acceptance.
 *
 * Seeds a FIFO queue with known prep times, then asserts ETA sums match
 * hand-computed expectations (PLAN §4.2). Acceptance criterion: ETA
 * accurate within ±5 min (300 s) with a seeded queue — asserted explicitly
 * plus the stronger deterministic exact match (seed is fixed).
 *
 * Requires a running Postgres with migrations applied (DATABASE_URL).
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, scoped } from "../src/lib/prisma";
import { OrderStatus } from "../src/generated/prisma/enums";
import {
  QUEUE_STATUSES,
  fetchQueue,
  etaForNewOrder,
  etaForOrderInQueue,
  isQueueFull,
  prepSecondsForItems,
  recalculateQueueEtas,
  sortQueue,
  withBuffer,
} from "../src/lib/queue";

const stamp = Date.now();
const slugQ = `queue-a-${stamp}`;
const slugEmpty = `queue-b-${stamp}`;

let tenantQ: { id: string; maxQueueSize: number; prepTimeBuffer: number };
let tenantEmpty: { id: string };
let mEspresso: { id: string }; // 120s
let mLatte: { id: string }; // 300s
let mTea: { id: string }; // 60s
let mFree: { id: string }; // 0s
let orderIds: string[] = []; // seeded in-queue order ids (FIFO)

const t0 = new Date(Date.now() - 60 * 60 * 1000); // base timestamp

beforeAll(async () => {
  tenantQ = await prisma.tenant.create({
    data: { slug: slugQ, name: "Queue A", maxQueueSize: 3, prepTimeBuffer: 1 },
    select: { id: true, maxQueueSize: true, prepTimeBuffer: true },
  });
  tenantEmpty = await prisma.tenant.create({
    data: { slug: slugEmpty, name: "Queue B" },
    select: { id: true },
  });

  const mkItem = (name: string, prep: number) =>
    prisma.menuItem.create({
      data: { tenantId: tenantQ.id, name, price: 1000, prepTimeSeconds: prep },
      select: { id: true },
    });
  mEspresso = await mkItem("Espresso", 120);
  mLatte = await mkItem("Latte", 300);
  mTea = await mkItem("Tea", 60);
  mFree = await mkItem("Free Water", 0);

  const createOrder = async (
    name: string,
    status: string,
    createdAt: Date,
    items: { id: string; qty: number }[]
  ): Promise<string> => {
    const o = await scoped(tenantQ.id).order.create({
      data: {
        customerName: name,
        customerPhone: "0812",
        status: status as OrderStatus,
        createdAt,
        items: {
          create: items.map((i) => ({ menuItemId: i.id, quantity: i.qty, unitPrice: 1000 })),
        },
      } as unknown as Parameters<typeof prisma.order.create>[0]["data"],
      select: { id: true },
    });
    return o.id;
  };

  // In-queue (FIFO by createdAt):
  //   A: 2×espresso + 1×latte = 240 + 300 = 540s   (PENDING)
  //   B: 1×tea = 60s                                (CONFIRMED)
  const idA = await createOrder("Ahead-A", "PENDING", new Date(t0.getTime() + 1000), [
    { id: mEspresso.id, qty: 2 },
    { id: mLatte.id, qty: 1 },
  ]);
  const idB = await createOrder("Ahead-B", "CONFIRMED", new Date(t0.getTime() + 2000), [
    { id: mTea.id, qty: 1 },
  ]);
  // Out of queue — must NEVER be counted (created BEFORE A to prove the
  // status filter, not the timestamp, is what excludes them):
  await createOrder("Ready", "READY_FOR_PICKUP", new Date(t0.getTime() + 500), [
    { id: mTea.id, qty: 5 },
  ]);
  await createOrder("Picked", "PICKED_UP", new Date(t0.getTime() + 600), [
    { id: mLatte.id, qty: 9 },
  ]);
  await createOrder("Cancelled", "CANCELLED", new Date(t0.getTime() + 700), [
    { id: mEspresso.id, qty: 9 },
  ]);
  orderIds = [idA, idB];
});

afterAll(async () => {
  // FK order: order items → orders → menu items → tenants.
  const tenants = [tenantQ.id, tenantEmpty.id];
  await prisma.orderItem.deleteMany({
    where: { order: { tenantId: { in: tenants } } },
  });
  await prisma.orderStatusLog.deleteMany({
    where: { order: { tenantId: { in: tenants } } },
  });
  await prisma.order.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.menuItem.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
});

describe("prep seconds (PLAN §4.2 building block)", () => {
  it("sums prep_time × qty across items", () => {
    expect(
      prepSecondsForItems([
        { quantity: 2, menuItem: { prepTimeSeconds: 120 } },
        { quantity: 1, menuItem: { prepTimeSeconds: 300 } },
      ])
    ).toBe(540);
    expect(prepSecondsForItems([{ quantity: 4, menuItem: { prepTimeSeconds: 0 } }])).toBe(0);
    expect(prepSecondsForItems([])).toBe(0);
  });

  it("sortQueue orders oldest first with id tiebreak", () => {
    const rows = [
      { id: "b", createdAt: new Date(2000) },
      { id: "a", createdAt: new Date(1000) },
      { id: "c", createdAt: new Date(1000) },
    ];
    expect(sortQueue(rows).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
});

describe("FIFO queue (issue #6)", () => {
  it("fetchQueue returns only queue statuses, oldest first", async () => {
    const queue = await fetchQueue(scoped(tenantQ.id), tenantQ.id);
    expect(queue.map((e) => e.id)).toEqual(orderIds);
    expect(queue.map((e) => e.prepSeconds)).toEqual([540, 60]);
  });

  it("excludes ready / picked-up / cancelled even when older", async () => {
    const queue = await fetchQueue(scoped(tenantQ.id), tenantQ.id);
    // ready(5×60) / picked(9×300) / cancelled(9×120) would sum 3420s if counted.
    expect(queue.reduce((a, e) => a + e.prepSeconds, 0)).toBe(600);
    expect(queue.length).toBe(2);
  });

  it("empty tenant has an empty queue", async () => {
    expect(await fetchQueue(scoped(tenantEmpty.id), tenantEmpty.id)).toEqual([]);
  });
});

describe("ETA calculation (PLAN §4.2)", () => {
  it("new order ETA = all queue ahead + own prep", async () => {
    const queue = await fetchQueue(scoped(tenantQ.id), tenantQ.id);
    const own = prepSecondsForItems([{ quantity: 1, menuItem: { prepTimeSeconds: 120 } }]);
    // ahead 540 + 60 = 600, + own 120 → 720
    expect(etaForNewOrder(queue, own)).toBe(720);
    // tenant buffer (1 min) folded in by the routes
    expect(withBuffer(etaForNewOrder(queue, own), tenantQ.prepTimeBuffer)).toBe(780);
  });

  it("existing order ETA = strictly-ahead orders + own (FIFO position)", async () => {
    const queue = await fetchQueue(scoped(tenantQ.id), tenantQ.id);
    expect(etaForOrderInQueue(queue, orderIds[0])).toBe(540); // first: own only
    expect(etaForOrderInQueue(queue, orderIds[1])).toBe(600); // 540 ahead + 60 own
  });

  it("empty queue → new order ETA = own prep only", async () => {
    const queue = await fetchQueue(scoped(tenantEmpty.id), tenantEmpty.id);
    const own = prepSecondsForItems([{ quantity: 1, menuItem: { prepTimeSeconds: 300 } }]);
    expect(etaForNewOrder(queue, own)).toBe(300);
  });

  it("acceptance: seeded queue ETA within ±5 min (300 s)", async () => {
    const queue = await fetchQueue(scoped(tenantQ.id), tenantQ.id);
    const own = prepSecondsForItems([{ quantity: 1, menuItem: { prepTimeSeconds: 120 } }]);
    const eta = withBuffer(etaForNewOrder(queue, own), tenantQ.prepTimeBuffer);
    const expected = 540 + 60 + 120 + 60; // queue + own + 1 min buffer
    expect(Math.abs(eta - expected)).toBeLessThanOrEqual(300); // acceptance tolerance
    expect(eta).toBe(expected); // deterministic seed → exact
  });
});

describe("order cap (PLAN §4.3 / issue #6)", () => {
  it("isQueueFull at or beyond maxQueueSize", () => {
    expect(isQueueFull(2, 3)).toBe(false);
    expect(isQueueFull(3, 3)).toBe(true);
    expect(isQueueFull(5, 3)).toBe(true);
  });

  it("queue length drives the cap for the seeded tenant (2 < max 3)", async () => {
    const queue = await fetchQueue(scoped(tenantQ.id), tenantQ.id);
    expect(isQueueFull(queue.length, tenantQ.maxQueueSize)).toBe(false);
  });
});

describe("queue recalc on order finish (PLAN §4.1)", () => {
  it("recalculateQueueEtas rewrites remaining orders after the first leaves", async () => {
    // A (first in queue) finishes → leaves the queue.
    await prisma.order.updateMany({
      where: { id: orderIds[0], tenantId: tenantQ.id },
      data: { status: OrderStatus.READY_FOR_PICKUP },
    });
    await recalculateQueueEtas(scoped(tenantQ.id), tenantQ.id, tenantQ.prepTimeBuffer);

    // B is now first: own 60 + buffer 60 = 120.
    const b = await prisma.order.findUnique({
      where: { id: orderIds[1] },
      select: { etaSeconds: true, etaCalculatedAt: true },
    });
    expect(b?.etaSeconds).toBe(120);
    expect(b?.etaCalculatedAt).not.toBeNull();

    // Restore A so sibling tests keep their seeded queue.
    await prisma.order.updateMany({
      where: { id: orderIds[0], tenantId: tenantQ.id },
      data: { status: OrderStatus.PENDING },
    });
    await recalculateQueueEtas(scoped(tenantQ.id), tenantQ.id, tenantQ.prepTimeBuffer);
    const a = await prisma.order.findUnique({
      where: { id: orderIds[0] },
      select: { etaSeconds: true },
    });
    expect(a?.etaSeconds).toBe(600); // own 540 + 1 min buffer (first in queue)
  });
});
