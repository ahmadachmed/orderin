// @vitest-environment node
/**
 * T17-12 (docs/T17-hybrid-plan.md — risk register #6): customer session
 * isolation across tenants.
 *
 * Risk #6: "Customer session reuse across tenants — Cookie is tenant-scoped
 * (slug in payload). Customer on tenant A cannot use same cookie on tenant B.
 * Enforced in server-side verify + account page slug check."
 *
 * Exercises the real route handlers against a live Postgres:
 *   POST /api/customer/register  (T17-2) — cookie minting
 *   POST /api/customer/login     (T17-3) — cross-tenant login refusal
 *   GET  /api/customer/orders    (T17-8) — cross-tenant data reachability
 *   GET  /api/customer/me        (T17-6) — identity stays tenant-bound
 *   /[tenantSlug]/account/orders page (T17-9) — slug mismatch → 404
 *
 * Plus unit-level checks on the stateless HMAC cookie itself
 * (src/lib/customer-auth.ts): payload tampering and admin/customer
 * session-type confusion are both rejected at verify time.
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST as postRegister } from "../src/app/api/customer/register/route";
import { POST as postLogin } from "../src/app/api/customer/login/route";
import { GET as getCustomerOrders } from "../src/app/api/customer/orders/route";
import { GET as getCustomerMe } from "../src/app/api/customer/me/route";
import { createCustomerSession, verifyCustomerSession } from "../src/lib/customer-auth";
import { createSession, verifySession } from "../src/lib/auth";
import { _resetRateLimitsForTest } from "../src/lib/rate-limit";
import AccountOrdersPage from "../src/app/[tenantSlug]/account/orders/page";
import { setupTenant, type TenantFixture } from "./helpers";

const fixtures: TenantFixture[] = [];

// Mock next/headers so getCustomerSession() reads our customer token store.
const { tokenStore } = vi.hoisted(() => ({ tokenStore: { current: null as string | null } }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "orderin_customer_session" && tokenStore.current
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
  _resetRateLimitsForTest();
});

function jsonReq(path: string, body: Record<string, unknown>, ip: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

async function registerReq(slug: string, phone: string, password: string, ip: string) {
  return postRegister(jsonReq("/api/customer/register", { slug, phone, password, name: "Pelanggan" }, ip));
}

async function loginReq(slug: string, phone: string, password: string, ip: string) {
  return postLogin(jsonReq("/api/customer/login", { slug, phone, password }, ip));
}

/** Extract the signed customer-session token from a route response's Set-Cookie. */
function extractCustomerToken(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/orderin_customer_session=([^;]+)/);
  if (!m) throw new Error("response did not set an orderin_customer_session cookie");
  return m[1];
}

/** Re-encode the token's payload with a foreign slug, keeping the original signature. */
function tamperSlug(token: string, newSlug: string): string {
  const [payload, sig] = token.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
  data.slug = newSlug;
  return `${Buffer.from(JSON.stringify(data)).toString("base64url")}.${sig}`;
}

describe("T17-12 — cookie minting is tenant-bound (risk #6)", () => {
  let fxA: TenantFixture;
  let fxB: TenantFixture;
  const phone = "0817-1001";
  const password = "rahasia123";
  let tokenA: string;
  let tokenB: string;
  let customerIdA: string;
  let customerIdB: string;

  beforeAll(async () => {
    fxA = await setupTenant();
    fxB = await setupTenant();
    fixtures.push(fxA, fxB);

    const regA = await registerReq(fxA.slug, phone, password, "10.40.1.1");
    expect(regA.status).toBe(201);
    tokenA = extractCustomerToken(regA);
    ({ customerId: customerIdA } = await regA.json());

    // Same phone re-registered on tenant B — allowed, @@unique([tenantId, phone]).
    const regB = await registerReq(fxB.slug, phone, password, "10.40.1.2");
    expect(regB.status).toBe(201);
    tokenB = extractCustomerToken(regB);
    ({ customerId: customerIdB } = await regB.json());
  });

  it("A's cookie verifies to tenant A's slug+tenantId; B's to tenant B's", () => {
    const sessA = verifyCustomerSession(tokenA);
    expect(sessA).not.toBeNull();
    expect(sessA!.tenantSlug).toBe(fxA.slug);
    expect(sessA!.tenantId).toBe(fxA.tenantId);

    const sessB = verifyCustomerSession(tokenB);
    expect(sessB).not.toBeNull();
    expect(sessB!.tenantSlug).toBe(fxB.slug);
    expect(sessB!.tenantId).toBe(fxB.tenantId);

    // The two sessions are never interchangeable.
    expect(sessA!.tenantId).not.toBe(sessB!.tenantId);
  });

  it("same phone on tenant B is a different customer identity (per-tenant unique)", () => {
    expect(customerIdA).not.toBe(customerIdB);
  });
});

describe("T17-12 — cross-tenant cookie replay is refused", () => {
  let fxA: TenantFixture;
  let fxB: TenantFixture;
  const phone = "0817-2001";
  const password = "rahasia123";
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    fxA = await setupTenant();
    fxB = await setupTenant();
    fixtures.push(fxA, fxB);

    const regA = await registerReq(fxA.slug, phone, password, "10.40.2.1");
    expect(regA.status).toBe(201);
    tokenA = extractCustomerToken(regA);

    const regB = await registerReq(fxB.slug, phone, password, "10.40.2.2");
    expect(regB.status).toBe(201);
    tokenB = extractCustomerToken(regB);
  });

  it("A's session cookie on B's account page → 404; B's on A's page → 404", async () => {
    tokenStore.current = tokenA;
    await expect(AccountOrdersPage({ params: Promise.resolve({ tenantSlug: fxB.slug }) })).rejects.toThrow(
      "__NOT_FOUND__"
    );
    expect(navMock.notFound).toHaveBeenCalled();

    navMock.notFound.mockClear();
    tokenStore.current = tokenB;
    await expect(AccountOrdersPage({ params: Promise.resolve({ tenantSlug: fxA.slug }) })).rejects.toThrow(
      "__NOT_FOUND__"
    );
    expect(navMock.notFound).toHaveBeenCalled();
  });

  it("no session at all → account page redirects to login with ?next (T20 ACCT-03)", async () => {
    await expect(AccountOrdersPage({ params: Promise.resolve({ tenantSlug: fxA.slug }) })).rejects.toThrow(
      "__REDIRECT__"
    );
    expect(navMock.redirect).toHaveBeenCalledWith(`/${fxA.slug}/login?next=account/orders`);
  });

  it("A's cookie never exposes B's order history via the orders API", async () => {
    // Give each tenant's customer an order of their own.
    const orderA = await prisma.order.create({
      data: {
        tenantId: fxA.tenantId,
        customerName: "Isolasi A",
        customerPhone: phone,
        status: "PENDING",
        paymentStatus: "UNPAID",
        items: { create: [{ menuItemId: fxA.itemAvailable, quantity: 1, unitPrice: 15000 }] },
      },
    });
    const orderB = await prisma.order.create({
      data: {
        tenantId: fxB.tenantId,
        customerName: "Isolasi B",
        customerPhone: phone,
        status: "PENDING",
        paymentStatus: "UNPAID",
        items: { create: [{ menuItemId: fxB.itemAvailable, quantity: 1, unitPrice: 15000 }] },
      },
    });

    // The bind: orders placed with the same phone get attached at register
    // time (T17-5). Attach explicitly to keep this test about isolation only.
    const customerA = await prisma.customer.findFirstOrThrow({
      where: { tenantId: fxA.tenantId, phone },
    });
    const customerB = await prisma.customer.findFirstOrThrow({
      where: { tenantId: fxB.tenantId, phone },
    });
    await prisma.order.update({ where: { id: orderA.id }, data: { customerId: customerA.id } });
    await prisma.order.update({ where: { id: orderB.id }, data: { customerId: customerB.id } });

    tokenStore.current = tokenA;
    const resA = await getCustomerOrders();
    expect(resA.status).toBe(200);
    const ordersA = await resA.json();
    expect(ordersA).toHaveLength(1);
    expect(ordersA[0].orderId).toBe(orderA.id);
    expect(ordersA[0].orderId).not.toBe(orderB.id);

    tokenStore.current = tokenB;
    const resB = await getCustomerOrders();
    expect(resB.status).toBe(200);
    const ordersB = await resB.json();
    expect(ordersB).toHaveLength(1);
    expect(ordersB[0].orderId).toBe(orderB.id);
    expect(ordersB[0].orderId).not.toBe(orderA.id);
  });
});

describe("T17-12 — cookie tamper resistance", () => {
  let fxA: TenantFixture;
  let fxB: TenantFixture;
  const phone = "0817-3001";
  const password = "rahasia123";
  let tokenA: string;

  beforeAll(async () => {
    fxA = await setupTenant();
    fxB = await setupTenant();
    fixtures.push(fxA, fxB);
    const regA = await registerReq(fxA.slug, phone, password, "10.40.3.1");
    expect(regA.status).toBe(201);
    tokenA = extractCustomerToken(regA);
  });

  it("payload rewritten with a foreign slug → signature invalid → session rejected", () => {
    const forged = tamperSlug(tokenA, fxB.slug);
    expect(verifyCustomerSession(forged)).toBeNull();
  });

  it("a forged cookie is refused by the orders API (401)", async () => {
    tokenStore.current = tamperSlug(tokenA, fxB.slug);
    const res = await getCustomerOrders();
    expect(res.status).toBe(401);
  });

  it("admin session token cannot act as a customer session (and vice versa)", () => {
    const adminToken = createSession(fxA.tenantId, "admin-probe");
    expect(verifyCustomerSession(adminToken)).toBeNull();

    const customerToken = createCustomerSession(fxA.tenantId, "cust-probe", fxA.slug);
    expect(verifySession(customerToken)).toBeNull();
  });

  it("admin token in the customer cookie slot → orders API 401, /me loggedIn false", async () => {
    tokenStore.current = createSession(fxA.tenantId, "admin-probe");
    const res = await getCustomerOrders();
    expect(res.status).toBe(401);

    const me = await getCustomerMe();
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ loggedIn: false });
  });
});

describe("T17-12 — cross-tenant login is refused", () => {
  let fxA: TenantFixture;
  let fxB: TenantFixture;
  const phone = "0817-4001";
  const password = "rahasia123";

  beforeAll(async () => {
    fxA = await setupTenant();
    fxB = await setupTenant();
    fixtures.push(fxA, fxB);
    // Customer exists ONLY on tenant A — no customer row on B.
    const regA = await registerReq(fxA.slug, phone, password, "10.40.4.1");
    expect(regA.status).toBe(201);
  });

  it("customer registered on A cannot log in on tenant B (401)", async () => {
    const res = await loginReq(fxB.slug, phone, password, "10.40.4.3");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Nomor HP atau password salah");
  });
});

describe("T17-12 — identity stays tenant-bound with the same phone on both tenants", () => {
  let fxA: TenantFixture;
  let fxB: TenantFixture;
  const phone = "0817-4002";
  const password = "rahasia123";
  let customerIdA: string;
  let customerIdB: string;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    fxA = await setupTenant();
    fxB = await setupTenant();
    fixtures.push(fxA, fxB);

    const regA = await registerReq(fxA.slug, phone, password, "10.40.4.1");
    expect(regA.status).toBe(201);
    tokenA = extractCustomerToken(regA);
    ({ customerId: customerIdA } = await regA.json());

    // Same phone on B is a distinct per-tenant account (T17-10 asserts the
    // register itself succeeds; here we pin that identity never crosses).
    const regB = await registerReq(fxB.slug, phone, password, "10.40.4.2");
    expect(regB.status).toBe(201);
    tokenB = extractCustomerToken(regB);
    ({ customerId: customerIdB } = await regB.json());
  });

  it("GET /api/customer/me returns only the cookie's own tenant identity", async () => {
    tokenStore.current = tokenA;
    const meA = await getCustomerMe();
    const bodyA = await meA.json();
    expect(bodyA.loggedIn).toBe(true);
    expect(bodyA.customerId).toBe(customerIdA);
    expect(bodyA.customerId).not.toBe(customerIdB);

    tokenStore.current = tokenB;
    const meB = await getCustomerMe();
    const bodyB = await meB.json();
    expect(bodyB.loggedIn).toBe(true);
    expect(bodyB.customerId).toBe(customerIdB);
    expect(bodyB.customerId).not.toBe(customerIdA);
  });
});
