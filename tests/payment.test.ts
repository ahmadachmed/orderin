// @vitest-environment node
/**
 * Payment flow — issue #8 critical path (PLAN §3.1.1).
 * Exercises the real PATCH /api/order/[orderId]/payment handler (public,
 * orderId UUID is the customer's bearer token): method selection, the
 * advisory "I have paid" note for bank transfers (CUSTOMER audit log),
 * already-paid refusal, and validation.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { PATCH } from "../src/app/api/order/[orderId]/payment/route";
import { setupTenant, cleanupTenant, createOrderDirect, type TenantFixture } from "./helpers";

const fixtures: TenantFixture[] = [];

async function patchPayment(orderId: string, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/order/${orderId}/payment`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ orderId }) });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("PATCH /api/order/[orderId]/payment", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
  });

  it("records a QRIS method choice (status stays UNPAID)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchPayment(order.id, { paymentMethod: "qris" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentMethod).toBe("qris");
    expect(body.paymentStatus).toBe("UNPAID");
  });

  it("bank_transfer 'I have paid' attaches a note + CUSTOMER audit log", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchPayment(order.id, {
      paymentMethod: "bank_transfer",
      customerTransferNote: "transfer dari BCA 1234",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentMethod).toBe("bank_transfer");
    expect(body.customerTransferNote).toBe("transfer dari BCA 1234");
    expect(body.paymentStatus).toBe("UNPAID"); // advisory — barista must verify

    const logs = await prisma.orderStatusLog.findMany({ where: { orderId: order.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorType).toBe("CUSTOMER");
    expect(logs[0].note).toMatch(/I have paid/);
  });

  it("bank_transfer with empty note sets paymentClaimedAt; a later claim is rejected (issue #224)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const first = await patchPayment(order.id, {
      paymentMethod: "bank_transfer",
      customerTransferNote: "",
    });
    expect(first.status).toBe(200);
    expect((await first.json()).paymentClaimedAt).toBeTruthy();

    const second = await patchPayment(order.id, {
      paymentMethod: "bank_transfer",
      customerTransferNote: "",
    });
    expect(second.status).toBe(409);
  });

  it("first claim sets paymentClaimedAt; duplicate claim returns 409 with no second audit log (issue #224)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const first = await patchPayment(order.id, {
      paymentMethod: "bank_transfer",
      customerTransferNote: "Budi BCA",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.paymentClaimedAt).toBeTruthy();
    expect(firstBody.customerTransferNote).toBe("Budi BCA");

    const second = await patchPayment(order.id, {
      paymentMethod: "bank_transfer",
      customerTransferNote: "Budi BCA lagi",
    });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Pembayaran sudah dikonfirmasi");

    const logs = await prisma.orderStatusLog.findMany({ where: { orderId: order.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].note).toMatch(/Budi BCA/);
  });

  it("audits an empty-note 'I have paid' claim too (issue #210)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchPayment(order.id, {
      paymentMethod: "bank_transfer",
      customerTransferNote: "",
    });
    expect(res.status).toBe(200);

    const logs = await prisma.orderStatusLog.findMany({ where: { orderId: order.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorType).toBe("CUSTOMER");
    expect(logs[0].note).toBe('Customer marked "I have paid"');
  });

  it("does not audit a plain bank_transfer method selection (issue #210)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const res = await patchPayment(order.id, { paymentMethod: "bank_transfer" });
    expect(res.status).toBe(200);

    const logs = await prisma.orderStatusLog.findMany({ where: { orderId: order.id } });
    expect(logs).toHaveLength(0);
  });

  it("refuses to change payment on an already-PAID order (409)", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable, { paymentStatus: "PAID" });
    const res = await patchPayment(order.id, { paymentMethod: "cash" });
    expect(res.status).toBe(409);
  });

  it("404 for unknown order", async () => {
    const res = await patchPayment("00000000-0000-4000-8000-000000000000", {
      paymentMethod: "cash",
    });
    expect(res.status).toBe(404);
  });

  it("400 for invalid method and for empty body", async () => {
    const order = await createOrderDirect(fx.tenantId, fx.itemAvailable);
    const bad = await patchPayment(order.id, { paymentMethod: "dogecoin" });
    expect(bad.status).toBe(400);

    const empty = await patchPayment(order.id, {});
    expect(empty.status).toBe(400);
  });
});
