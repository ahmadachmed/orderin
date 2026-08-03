/**
 * Tenant isolation integration tests — issue #3 acceptance criterion.
 *
 * Verifies the Prisma tenant-scoping layers (src/lib/prisma.ts, PLAN §2.2):
 * - `scoped(tenantId)` filters reads, rewrites findUnique/update/delete so a
 *   foreign tenant's row can never be reached by id, and injects tenantId
 *   into creates (pre-validation)
 * - the extension FAILS CLOSED: list/mutate queries on tenant-scoped models
 *   without any tenantId (context or args) are refused
 * - findUnique by UUID without a tenant context stays allowed (public order
 *   status lookup — a globally-unique id cannot leak a list)
 *
 * Requires a running Postgres with migrations applied (DATABASE_URL).
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, scoped } from "../src/lib/prisma";

const stamp = Date.now();
const slugA = `iso-a-${stamp}`;
const slugB = `iso-b-${stamp}`;

let tenantA: { id: string };
let tenantB: { id: string };
let itemA: { id: string };
let itemB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { slug: slugA, name: "Isolation A" },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { slug: slugB, name: "Isolation B" },
    select: { id: true },
  });
  itemA = await prisma.menuItem.create({
    data: { tenantId: tenantA.id, name: "A-Only", price: 1000 },
    select: { id: true },
  });
  itemB = await prisma.menuItem.create({
    data: { tenantId: tenantB.id, name: "B-Only", price: 2000 },
    select: { id: true },
  });
});

afterAll(async () => {
  // Raw client + explicit tenantId (ops path — allowed by the extension).
  await prisma.menuItem.deleteMany({
    where: { tenantId: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.tenantAdmin.deleteMany({
    where: { tenantId: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
});

describe("tenant-scoped reads", () => {
  it("findMany only returns items of the scoped tenant", async () => {
    const inA = await scoped(tenantA.id).menuItem.findMany({ where: { isAvailable: true } });
    expect(inA.map((i) => i.id)).toEqual([itemA.id]);

    const inB = await scoped(tenantB.id).menuItem.findMany({ where: { isAvailable: true } });
    expect(inB.map((i) => i.id)).toEqual([itemB.id]);
  });

  it("findUnique by foreign id returns null (rewritten to findFirst)", async () => {
    const hit = await scoped(tenantA.id).menuItem.findUnique({ where: { id: itemB.id } });
    expect(hit).toBeNull();
  });

  it("unscoped list query on a scoped model is refused (fail-closed)", async () => {
    await expect(
      prisma.menuItem.findMany({ where: { isAvailable: true } })
    ).rejects.toThrow(/tenantId/);
  });
});

describe("tenant-scoped writes", () => {
  it("create injects tenantId automatically", async () => {
    const created = await scoped(tenantA.id).menuItem.create({
      data: {
        name: "Injected",
        price: 5000,
      } as unknown as Parameters<typeof prisma.menuItem.create>[0]["data"],
    });
    expect(created.tenantId).toBe(tenantA.id);
    await prisma.menuItem.deleteMany({ where: { id: created.id, tenantId: tenantA.id } });
  });

  it("update by foreign id affects 0 rows", async () => {
    const res = (await scoped(tenantA.id).menuItem.update({
      where: { id: itemB.id },
      data: { name: "hacked" },
    })) as unknown as { count: number };
    expect(res.count).toBe(0);

    const untouched = await prisma.menuItem.findUnique({ where: { id: itemB.id } });
    expect(untouched?.name).toBe("B-Only");
  });

  it("delete by foreign id affects 0 rows", async () => {
    const res = (await scoped(tenantA.id).menuItem.delete({
      where: { id: itemB.id },
    })) as unknown as { count: number };
    expect(res.count).toBe(0);

    const stillThere = await prisma.menuItem.findUnique({ where: { id: itemB.id } });
    expect(stillThere).not.toBeNull();
  });
});

describe("orders are tenant-scoped", () => {
  it("order.create gets tenantId injected; nested order items are created", async () => {
    const order = await scoped(tenantA.id).order.create({
      data: {
        customerName: "Tester",
        customerPhone: "0812",
        items: { create: [{ menuItemId: itemA.id, quantity: 2, unitPrice: 1000 }] },
      } as unknown as Parameters<typeof prisma.order.create>[0]["data"],
    });
    expect(order.tenantId).toBe(tenantA.id);

    const itemRows = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0].menuItemId).toBe(itemA.id);

    const inB = await scoped(tenantB.id).order.findUnique({ where: { id: order.id } });
    expect(inB).toBeNull();

    // cleanup order + its items (FK: delete items first)
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id, tenantId: tenantA.id } });
  });

  it("findUnique by UUID without tenant context is allowed (public status lookup)", async () => {
    const order = await prisma.order.create({
      data: {
        tenantId: tenantB.id,
        customerName: "Public",
        customerPhone: "0813",
      },
    });
    const found = await prisma.order.findUnique({ where: { id: order.id } });
    expect(found?.id).toBe(order.id);
    await prisma.order.deleteMany({ where: { id: order.id, tenantId: tenantB.id } });
  });
});
