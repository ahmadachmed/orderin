// @vitest-environment node
/**
 * T17-11 (docs/T17-hybrid-plan.md §T17-11 "Order history tests"): customer
 * order history — GET /api/customer/orders (T17-8) + the account orders page
 * guard (T17-9 server component). UI component behavior lives in
 * tests/components/AccountOrdersList.test.tsx (jsdom).
 *
 * Exercises the real route handler against a live Postgres with a mocked
 * stateless HMAC customer session cookie (src/lib/customer-auth.ts):
 *   - 401 without a session
 *   - empty history → []
 *   - orders owned by the customer, newest first
 *   - response shape: orderId, status, createdAt, itemCount, summary
 *   - itemCount sums quantities; summary is "2× Item A, 1× Item B"
 *   - another customer's orders are never visible
 *   - phone-match bound orders (T17-5) appear in history
 *
 * Page part (T17-9): redirect without session, 404 on tenant-slug mismatch,
 * renders the AccountOrdersList client component for a valid session.
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { GET as getCustomerOrders } from "../src/app/api/customer/orders/route";
import { createCustomerSession } from "../src/lib/customer-auth";
import AccountOrdersPage from "../src/app/[tenantSlug]/account/orders/page";
import AccountOrdersList from "../src/components/AccountOrdersList";
import { setupTenant, type TenantFixture } from "./helpers";

const fixtures: TenantFixture[] = [];

// Mock next/headers so getCustomerSession() reads our customer token store.
const { tokenStore } = vi.hoisted(() => ({ tokenStore: { current: null as string | null } }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "headwaybrew_customer_session" && tokenStore.current
        ? { value: tokenStore.current }
        : undefined,
  }),
}));

// Mock next/navigation so the page's redirect()/notFound() are observable.
const { navMock } = vi.hoisted(() => ({
  navMock: {
    redirect: vi.fn(() => {
      throw new Error("__REDIRECT__");
    }),
    notFound: vi.fn(() => {
      throw new Error("__NOT_FOUND__");
    }),
  },
}));
vi.mock("next/navigation", () => ({
  redirect: navMock.redirect,
  notFound: navMock.notFound,
}));

function makeSession(tenantId: string, customerId: string, slug: string) {
  return createCustomerSession(tenantId, customerId, slug);
}

/** Cleanup mirroring helpers.cleanupTenant plus Customer rows (FK order). */
async function cleanupCustomerTenant(tenantId: string) {
  const orders = await prisma.order.findMany({ where: { tenantId }, select: { id: true } });
  for (const o of orders) {
    await prisma.orderStatusLog.deleteMany({ where: { orderId: o.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
  }
  await prisma.order.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.menuItem.deleteMany({ where: { tenantId } });
  await prisma.tenantAdmin.deleteMany({ where: { tenantId } });
  await prisma.sprint.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupCustomerTenant(f.tenantId);
});

beforeEach(() => {
  tokenStore.current = null;
  navMock.redirect.mockClear();
  navMock.notFound.mockClear();
});

describe("T17-8 — GET /api/customer/orders", () => {
  let fx: TenantFixture;
  let customerId: string;
  const phone = "0815-7001";

  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    // Create the customer directly (auth flows are covered by T17-10).
    const customer = await prisma.customer.create({
      data: { tenantId: fx.tenantId, name: "Budi", phone, passwordHash: "hash" },
    });
    customerId = customer.id;
  });

  it("401 without a session", async () => {
    const res = await getCustomerOrders();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns [] for a customer with no orders", async () => {
    tokenStore.current = makeSession(fx.tenantId, customerId, fx.slug);
    const res = await getCustomerOrders();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("lists only own orders, newest first, with the T17-8 shape", async () => {
    tokenStore.current = makeSession(fx.tenantId, customerId, fx.slug);

    const older = await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerId,
        customerName: "Budi",
        customerPhone: phone,
        status: "PICKED_UP",
        paymentStatus: "PAID",
        createdAt: new Date("2026-08-01T08:00:00.000Z"),
        items: {
          create: [
            { menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 },
            { menuItemId: fx.itemUnavailable, quantity: 2, unitPrice: 20000 },
          ],
        },
      },
    });
    const newer = await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerId,
        customerName: "Budi",
        customerPhone: phone,
        status: "PENDING",
        paymentStatus: "UNPAID",
        createdAt: new Date("2026-08-02T08:00:00.000Z"),
        items: { create: [{ menuItemId: fx.itemAvailable, quantity: 2, unitPrice: 15000 }] },
      },
    });

    const res = await getCustomerOrders();
    expect(res.status).toBe(200);
    const orders = await res.json();
    expect(orders).toHaveLength(2);

    // Newest first.
    expect(orders[0].orderId).toBe(newer.id);
    expect(orders[1].orderId).toBe(older.id);

    // Shape + aggregation.
    expect(orders[0]).toEqual({
      orderId: newer.id,
      status: "PENDING",
      createdAt: newer.createdAt.toISOString(),
      itemCount: 2,
      summary: "2× Item A",
    });
    expect(orders[1]).toEqual({
      orderId: older.id,
      status: "PICKED_UP",
      createdAt: older.createdAt.toISOString(),
      itemCount: 3,
      summary: "1× Item A, 2× Item B",
    });
  });

  it("never exposes another customer's orders", async () => {
    tokenStore.current = makeSession(fx.tenantId, customerId, fx.slug);

    const other = await prisma.customer.create({
      data: { tenantId: fx.tenantId, name: "Sari", phone: "0815-7002", passwordHash: "hash" },
    });
    await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerId: other.id,
        customerName: "Sari",
        customerPhone: "0815-7002",
        status: "CONFIRMED",
        paymentStatus: "UNPAID",
        items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
      },
    });

    const res = await getCustomerOrders();
    const orders = await res.json();
    expect(orders).toHaveLength(2); // still just the fixture customer's two
    expect(orders.every((o: { orderId: string }) => o.orderId !== other.id)).toBe(true);
  });

  it("includes phone-match bound orders (T17-5 integration)", async () => {
    // An order bound to the customer (as register/login does — T17-5) must
    // show up in history even when created earlier.
    const bound = await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerId,
        customerName: "Budi",
        customerPhone: phone,
        status: "BREWING",
        paymentStatus: "PAID",
        createdAt: new Date("2026-07-30T08:00:00.000Z"),
        items: { create: [{ menuItemId: fx.itemUnavailable, quantity: 1, unitPrice: 20000 }] },
      },
    });

    tokenStore.current = makeSession(fx.tenantId, customerId, fx.slug);
    const res = await getCustomerOrders();
    const orders = await res.json();
    const found = orders.find((o: { orderId: string }) => o.orderId === bound.id);
    expect(found).toBeDefined();
    expect(found.status).toBe("BREWING");
    expect(found.itemCount).toBe(1);
    expect(found.summary).toBe("1× Item B");
  });
});

describe("T17-9 — /[tenantSlug]/account/orders page", () => {
  let fx: TenantFixture;
  let customerId: string;

  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    const customer = await prisma.customer.create({
      data: { tenantId: fx.tenantId, name: "Budi", phone: "0816-8001", passwordHash: "hash" },
    });
    customerId = customer.id;
  });

  it("redirects to login with ?next=account/orders when there is no session (T20 ACCT-03)", async () => {
    await expect(AccountOrdersPage({ params: Promise.resolve({ tenantSlug: fx.slug }) })).rejects.toThrow(
      "__REDIRECT__"
    );
    expect(navMock.redirect).toHaveBeenCalledWith(`/${fx.slug}/login?next=account/orders`);
  });

  it("404s when the session belongs to a different tenant slug", async () => {
    tokenStore.current = makeSession(fx.tenantId, customerId, "some-other-shop");
    await expect(
      AccountOrdersPage({ params: Promise.resolve({ tenantSlug: fx.slug }) })
    ).rejects.toThrow("__NOT_FOUND__");
    expect(navMock.notFound).toHaveBeenCalled();
  });

  it("renders the history page for a valid session", async () => {
    tokenStore.current = makeSession(fx.tenantId, customerId, fx.slug);
    const el = await AccountOrdersPage({ params: Promise.resolve({ tenantSlug: fx.slug }) });
    // <main> with the AccountOrdersList client component inside.
    expect(el.type).toBe("main");
    const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
    expect(children.some((c: { type?: unknown }) => c && c.type === AccountOrdersList)).toBe(true);
  });
});
