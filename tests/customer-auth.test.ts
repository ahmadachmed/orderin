// @vitest-environment node
/**
 * T17-10 (docs/T17-hybrid-plan.md §T17-10): customer auth integration tests —
 * register / login / logout / rate limits / phone-match bind / tenant
 * isolation. Exercises the real route handlers against a live Postgres:
 *   POST /api/customer/register  (T17-2, #55)
 *   POST /api/customer/login     (T17-3, #56)
 *   POST /api/customer/logout    (T17-4, #57)
 *   phone-match bind on register/login (T17-5, #58)
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST as postRegister } from "../src/app/api/customer/register/route";
import { POST as postLogin } from "../src/app/api/customer/login/route";
import { POST as postLogout } from "../src/app/api/customer/logout/route";
import { _resetRateLimitsForTest } from "../src/lib/rate-limit";
import { setupTenant, type TenantFixture } from "./helpers";

const fixtures: TenantFixture[] = [];

/**
 * Local cleanup: same as helpers.cleanupTenant plus Customer rows (T17) —
 * tenants now have customers, and cleanupTenant's tenant.deleteMany would
 * otherwise violate Customer_tenantId_fkey.
 */
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

async function registerReq(slug: string, phone: string, password: string, ip: string, name = "Pelanggan") {
  return postRegister(jsonReq("/api/customer/register", { slug, phone, password, name }, ip));
}

async function loginReq(slug: string, phone: string, password: string, ip: string) {
  return postLogin(jsonReq("/api/customer/login", { slug, phone, password }, ip));
}

function expectSessionCookie(res: Response) {
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("orderin_customer_session=");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
}

async function createUnboundOrder(tenantId: string, itemId: string, customerPhone: string) {
  return prisma.order.create({
    data: {
      tenantId,
      customerName: "Beli Sebelum Daftar",
      customerPhone,
      status: "PENDING",
      paymentStatus: "UNPAID",
      items: { create: [{ menuItemId: itemId, quantity: 1, unitPrice: 15000 }] },
    },
  });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupCustomerTenant(f.tenantId);
});

describe("customer auth — register", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
  });
  beforeEach(() => _resetRateLimitsForTest());

  it("register → 201 + session cookie", async () => {
    const res = await registerReq(fx.slug, "0811-1001", "rahasia123", "10.20.0.1");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.customerId).toBe("string");
    expectSessionCookie(res);
  });

  it("register duplicate phone → 409", async () => {
    const phone = "0811-1002";
    const first = await registerReq(fx.slug, phone, "rahasia123", "10.20.0.2");
    expect(first.status).toBe(201);

    const dup = await registerReq(fx.slug, phone, "rahasia123", "10.20.0.3");
    expect(dup.status).toBe(409);
    const body = await dup.json();
    expect(body.error).toContain("terdaftar");
  });

  it("register short password → 400", async () => {
    const res = await registerReq(fx.slug, "0811-1003", "123", "10.20.0.4");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("6 karakter");
  });

  it("register missing fields → 400", async () => {
    const res = await postRegister(
      jsonReq("/api/customer/register", { slug: fx.slug, phone: "0811-1004" }, "10.20.0.5")
    );
    expect(res.status).toBe(400);
  });
});

describe("customer auth — login", () => {
  let fx: TenantFixture;
  const phone = "0811-2001";
  const password = "rahasia123";
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    const reg = await registerReq(fx.slug, phone, password, "10.20.1.0");
    expect(reg.status).toBe(201);
  });
  beforeEach(() => _resetRateLimitsForTest());

  it("login valid → 200 + session cookie", async () => {
    const res = await loginReq(fx.slug, phone, password, "10.20.1.1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expectSessionCookie(res);
  });

  it("login wrong password → 401", async () => {
    const res = await loginReq(fx.slug, phone, "salah-sandi", "10.20.1.2");
    expect(res.status).toBe(401);
  });

  it("login unknown phone → 401", async () => {
    const res = await loginReq(fx.slug, "0899-9999", password, "10.20.1.3");
    expect(res.status).toBe(401);
  });
});

describe("customer auth — logout", () => {
  let fx: TenantFixture;
  const phone = "0811-3001";
  const password = "rahasia123";
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    const reg = await registerReq(fx.slug, phone, password, "10.20.2.0");
    expect(reg.status).toBe(201);
  });
  beforeEach(() => _resetRateLimitsForTest());

  it("logout clears cookie", async () => {
    const res = await postLogout();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("orderin_customer_session=");
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("customer auth — rate limits", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
  });
  beforeEach(() => _resetRateLimitsForTest());

  it("register: max 3/min per IP → 4th is 429", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await registerReq(fx.slug, `0812-40${i}`, "rahasia123", "10.20.3.1");
      expect(res.status).toBe(201);
    }
    const blocked = await registerReq(fx.slug, "0812-4099", "rahasia123", "10.20.3.1");
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toContain("Too many requests");
  });

  it("login: max 10/min per IP → 11th is 429", async () => {
    const ip = "10.20.3.2";
    for (let i = 0; i < 10; i++) {
      // Unknown phones still count toward the login limit (route checks RL first).
      const res = await loginReq(fx.slug, `0898-00${i}`, "rahasia123", ip);
      expect([401, 200]).toContain(res.status);
    }
    const blocked = await loginReq(fx.slug, "0898-0099", "rahasia123", ip);
    expect(blocked.status).toBe(429);
  });
});

describe("customer auth — phone-match bind (T17-5)", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
  });
  beforeEach(() => _resetRateLimitsForTest());

  it("past orders linked on register", async () => {
    const phone = "0813-5001";
    const order = await createUnboundOrder(fx.tenantId, fx.itemAvailable, phone);

    const res = await registerReq(fx.slug, phone, "rahasia123", "10.20.4.1");
    expect(res.status).toBe(201);
    const { customerId } = await res.json();

    const bound = await prisma.order.findUnique({ where: { id: order.id } });
    expect(bound?.customerId).toBe(customerId);
  });

  it("past orders linked on login", async () => {
    const phone = "0813-5002";
    const reg = await registerReq(fx.slug, phone, "rahasia123", "10.20.4.2");
    expect(reg.status).toBe(201);

    // Order placed after registration but before first login — no account yet.
    const order = await createUnboundOrder(fx.tenantId, fx.itemAvailable, phone);

    const res = await loginReq(fx.slug, phone, "rahasia123", "10.20.4.3");
    expect(res.status).toBe(200);
    const { customerId } = await res.json();

    const bound = await prisma.order.findUnique({ where: { id: order.id } });
    expect(bound?.customerId).toBe(customerId);
  });
});

describe("customer auth — tenant isolation", () => {
  let fxA: TenantFixture;
  let fxB: TenantFixture;
  const phone = "0814-6001";
  const password = "rahasia123";
  beforeAll(async () => {
    fxA = await setupTenant();
    fxB = await setupTenant();
    fixtures.push(fxA, fxB);
    const reg = await registerReq(fxA.slug, phone, password, "10.20.5.0");
    expect(reg.status).toBe(201);
  });
  beforeEach(() => _resetRateLimitsForTest());

  it("customer from tenant A cannot login on tenant B", async () => {
    const res = await loginReq(fxB.slug, phone, password, "10.20.5.1");
    expect(res.status).toBe(401);
  });

  it("registering same phone on tenant B is allowed (per-tenant unique)", async () => {
    const res = await registerReq(fxB.slug, phone, password, "10.20.5.2");
    expect(res.status).toBe(201);
  });
});
