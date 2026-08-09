// @vitest-environment node
/**
 * Issue #135 — invalid (non-UUID) orderId must return 404, not 500.
 *
 * Before the fix, a malformed id like "xxx" reached Prisma, which threw
 * `invalid input syntax for type uuid` → 500. Every order-by-id route now
 * format-checks the param BEFORE the DB call. These tests exercise the real
 * handlers with an invalid uuid and assert a clean 404 (no fixtures needed —
 * the validation short-circuits before any query).
 */
import "dotenv/config";
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { isValidUuid } from "../src/lib/uuid";
import { createSession } from "../src/lib/auth";
import { GET as getOrder } from "../src/app/api/order/[orderId]/route";
import { PATCH as patchPayment } from "../src/app/api/order/[orderId]/payment/route";
import { PATCH as patchAdminOrder } from "../src/app/api/admin/orders/[orderId]/route";

// Mock next/headers so the admin route's getSession() sees an authenticated
// barista (validation runs after the auth gate — issue #135 keeps 401 first).
const { tokenStore } = vi.hoisted(() => ({ tokenStore: { current: null as string | null } }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "orderin_admin_session" && tokenStore.current
        ? { value: tokenStore.current }
        : undefined,
  }),
}));

describe("isValidUuid (lib/uuid)", () => {
  it("accepts canonical UUIDs", () => {
    expect(isValidUuid("4d1f2c3a-9b8e-4f7d-8c6a-1b2c3d4e5f60")).toBe(true);
    expect(isValidUuid("4D1F2C3A-9B8E-4F7D-8C6A-1B2C3D4E5F60")).toBe(true); // case-insensitive
  });

  it("rejects non-UUID strings", () => {
    expect(isValidUuid("xxx")).toBe(false);
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("4d1f2c3a-9b8e-4f7d-8c6a-1b2c3d4e5f6")).toBe(false); // too short
    expect(isValidUuid("not-a-uuid-at-all")).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
  });
});

describe("invalid orderId → 404 (issue #135)", () => {
  it("GET /api/order/[orderId] returns 404 for malformed uuid", async () => {
    const req = new NextRequest("http://localhost/api/order/xxx", { method: "GET" });
    const res = await getOrder(req, { params: { orderId: "xxx" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Order not found" });
  });

  it("PATCH /api/order/[orderId]/payment returns 404 for malformed uuid", async () => {
    const req = new NextRequest("http://localhost/api/order/xxx/payment", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentMethod: "qris" }),
    });
    const res = await patchPayment(req, { params: { orderId: "xxx" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Order not found" });
  });

  it("PATCH /api/admin/orders/[orderId] returns 404 for malformed uuid (authenticated)", async () => {
    // Real signed session (HMAC-verified by getSession) — auth passes, so the
    // uuid check is what must 404. No DB rows needed: validation runs before
    // any query.
    tokenStore.current = createSession(
      "00000000-0000-4000-8000-000000000000",
      "00000000-0000-4000-8000-000000000000"
    );
    const req = new NextRequest("http://localhost/api/admin/orders/xxx", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "CONFIRMED" }),
    });
    const res = await patchAdminOrder(req, { params: { orderId: "xxx" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Order not found" });
  });

  it("well-formed but unknown uuid still 404s (not 500)", async () => {
    const req = new NextRequest(
      "http://localhost/api/order/00000000-0000-4000-8000-000000000000",
      { method: "GET" }
    );
    const res = await getOrder(req, {
      params: { orderId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(res.status).toBe(404);
  });
});
