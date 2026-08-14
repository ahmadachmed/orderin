// @vitest-environment node
/**
 * T16-9 (docs/T17-hybrid-plan.md §T16-9): integration tests for the T16 gaps
 * covered by the customer-facing order progress path — PICKUP-01 PIN
 * generation (order create), CUST-02 phone lookup, and CUST-01 status
 * timeline (statusLogs). Exercises the real route handlers against a live
 * Postgres; admin-session routes use a mocked cookie (src/lib/auth).
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "../src/lib/auth";
import { POST as postOrder } from "../src/app/api/order/route";
import { POST as postLookup } from "../src/app/api/order/lookup/route";
import { GET as getOrder } from "../src/app/api/order/[orderId]/route";
import { PATCH as patchOrder } from "../src/app/api/admin/orders/[orderId]/route";
import { _resetRateLimitsForTest } from "../src/lib/rate-limit";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";

// Mock next/headers so getSession() reads our admin token (for admin PATCH).
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

async function postOrderReq(slug: string, body: Record<string, unknown>) {
  const req = new NextRequest("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return postOrder(req);
}

async function lookupReq(slug: string, phone: string, ip: string) {
  const req = new NextRequest("http://localhost/api/order/lookup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ slug, phone }),
  });
  return postLookup(req);
}

async function getOrderReq(orderId: string) {
  const req = new NextRequest(`http://localhost/api/order/${orderId}`, { method: "GET" });
  return getOrder(req, { params: Promise.resolve({ orderId }) });
}

async function patchOrderReq(orderId: string, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return patchOrder(req, { params: Promise.resolve({ orderId }) });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("POST /api/order — PIN generation (PICKUP-01)", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
  });

  it("generates a 4-digit pickup PIN (1000-9999) on order create", async () => {
    const res = await postOrderReq(fx.slug, {
      slug: fx.slug,
      customerName: "Budi",
      customerPhone: "0811-0001",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    const order = await prisma.order.findUnique({ where: { id: body.orderId } });
    expect(order?.pickupCode).toMatch(/^[1-9]\d{3}$/); // 4 digits, never 0-prefixed
  });

  it("exposes pickupCode via the customer GET (null for legacy orders only)", async () => {
    const res = await postOrderReq(fx.slug, {
      slug: fx.slug,
      customerName: "Sari",
      customerPhone: "0811-0002",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    const created = await res.json();

    const order = await prisma.order.findUnique({ where: { id: created.orderId } });
    const got = await getOrderReq(created.orderId);
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.pickupCode).toBe(order?.pickupCode);
    expect(body.pickupCode).toMatch(/^[1-9]\d{3}$/);
  });
});

describe("POST /api/order/lookup — CUST-02 phone lookup", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
  });
  beforeEach(() => _resetRateLimitsForTest());

  it("returns the customer's active order (200)", async () => {
    const created = await postOrderReq(fx.slug, {
      slug: fx.slug,
      customerName: "Rina",
      customerPhone: "0812-1111",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    expect(created.status).toBe(201);
    const { orderId } = await created.json();

    const res = await lookupReq(fx.slug, "0812-1111", "10.1.0.1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderId).toBe(orderId);
    expect(body.status).toBe("PENDING");
    expect(body.customerName).toBe("Rina");
  });

  it("returns 404 for a terminal (PICKED_UP) order — not resumable", async () => {
    const created = await postOrderReq(fx.slug, {
      slug: fx.slug,
      customerName: "Dewi",
      customerPhone: "0812-2222",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    const { orderId } = await created.json();
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "PICKED_UP", etaSeconds: null },
    });

    const res = await lookupReq(fx.slug, "0812-2222", "10.1.0.2");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown phone", async () => {
    const res = await lookupReq(fx.slug, "0812-9999", "10.1.0.3");
    expect(res.status).toBe(404);
  });

  it("is rate-limited to 5/min per IP (429 on the 6th)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await lookupReq(fx.slug, `0812-3${i}00`, "10.9.9.9");
      expect(res.status).not.toBe(429);
    }
    const blocked = await lookupReq(fx.slug, "0812-3600", "10.9.9.9");
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe("Too many requests");
    expect(body.retryAfterSec).toBeGreaterThan(0);
  });

  it("enforces tenant isolation — same phone on another tenant returns 404", async () => {
    const other = await setupTenant();
    fixtures.push(other);
    // Same phone exists only on tenant A.
    await postOrderReq(fx.slug, {
      slug: fx.slug,
      customerName: "Isol",
      customerPhone: "0812-7777",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });

    const inA = await lookupReq(fx.slug, "0812-7777", "10.1.0.4");
    expect(inA.status).toBe(200);
    const inB = await lookupReq(other.slug, "0812-7777", "10.1.0.5");
    expect(inB.status).toBe(404); // same phone, different tenant → not found
  });

  it("requires phone and slug (400)", async () => {
    const req = new NextRequest("http://localhost/api/order/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.1.0.6" },
      body: JSON.stringify({ slug: fx.slug }),
    });
    const res = await postLookup(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/order/[orderId] — CUST-01 status timeline", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("returns statusLogs in ascending chronological order", async () => {
    const created = await postOrderReq(fx.slug, {
      slug: fx.slug,
      customerName: "Timeline",
      customerPhone: "0813-0001",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    const { orderId } = await created.json();

    // Walk the full state machine: CONFIRMED → PAID → BREWING → READY.
    expect((await patchOrderReq(orderId, { status: "CONFIRMED" })).status).toBe(200);
    expect(
      (await patchOrderReq(orderId, { paymentStatus: "PAID", paymentMethod: "qris" })).status
    ).toBe(200);
    expect((await patchOrderReq(orderId, { status: "BREWING" })).status).toBe(200);
    expect((await patchOrderReq(orderId, { status: "READY_FOR_PICKUP" })).status).toBe(200);

    const res = await getOrderReq(orderId);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.statusLogs)).toBe(true);
    expect(body.statusLogs.length).toBeGreaterThanOrEqual(5); // created + 4 transitions
    const statuses = body.statusLogs.map((l: { status: string }) => l.status);
    expect(statuses[0]).toBe("PENDING");
    // Chronologically ascending: createdAt is non-decreasing.
    const times = body.statusLogs.map((l: { createdAt: string }) => new Date(l.createdAt).getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
  });

  it("statusLogs carry actorType and timestamps for every entry", async () => {
    const created = await postOrderReq(fx.slug, {
      slug: fx.slug,
      customerName: "Actor",
      customerPhone: "0813-0002",
      items: [{ menuItemId: fx.itemAvailable, quantity: 1 }],
    });
    const { orderId } = await created.json();
    expect((await patchOrderReq(orderId, { status: "CONFIRMED" })).status).toBe(200);

    const res = await getOrderReq(orderId);
    const body = await res.json();

    // POST-time PENDING log is system-created (no actor); every transition
    // log is attributed to the authenticated barista.
    const pending = body.statusLogs.find((l: { status: string }) => l.status === "PENDING");
    expect(pending.actorType).toBeNull();
    expect(new Date(pending.createdAt).getTime()).toBeGreaterThan(0);

    const confirmed = body.statusLogs.find((l: { status: string }) => l.status === "CONFIRMED");
    expect(confirmed.actorType).toBe("BARISTA");
    expect(confirmed.actorName).toBeTruthy();
    expect(new Date(confirmed.createdAt).getTime()).toBeGreaterThan(0);

    for (const log of body.statusLogs) {
      expect(log.id).toBeTruthy();
      expect(log.status).toBeTruthy();
      expect(Number.isNaN(new Date(log.createdAt).getTime())).toBe(false);
    }
  });
});
