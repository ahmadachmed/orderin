/**
 * POST /api/order — create an order (status PENDING, payment UNPAID).
 * PLAN §9.1 / §3.2. Guards: shop open flag, operating hours (PLAN §4.3).
 * Full queue/ETA math (order cap, FIFO ETA) is T5 (issue #6, lib/queue.ts);
 * here we store a basic self-prep ETA so the status endpoint has data.
 */
import { NextRequest } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, HttpError, readJson } from "@/lib/api";
import { isWithinHours } from "@/lib/time";
import { PaymentMethod } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const PAYMENT_METHODS = new Set<string>(["qris", "bank_transfer", "cash"]);

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body", 400);

  const slug = typeof body.slug === "string" ? body.slug : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim() : "";
  const itemsRaw = Array.isArray(body.items) ? body.items : [];
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : undefined;

  if (!slug || !customerName || !customerPhone) {
    return fail("slug, customerName, customerPhone are required", 400);
  }
  if (itemsRaw.length === 0) return fail("items[] must contain at least one item", 400);
  if (paymentMethod !== undefined && !PAYMENT_METHODS.has(paymentMethod)) {
    return fail("paymentMethod must be qris, bank_transfer or cash", 400);
  }

  const items = itemsRaw.map((it) => {
    const row = it as Record<string, unknown>;
    const menuItemId = typeof row.menuItemId === "string" ? row.menuItemId : "";
    const quantity = Math.floor(Number(row.quantity));
    if (!menuItemId || !Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
      throw new HttpError(400, "Each item needs menuItemId (string) and quantity (1-99)");
    }
    return { menuItemId, quantity };
  });

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return fail("Tenant not found", 404);
  if (!tenant.isOpen) return fail("Shop is closed", 422);
  if (!isWithinHours(tenant.openTime, tenant.closeTime)) {
    return fail(`Shop is closed — opens at ${tenant.openTime} UTC`, 422);
  }

  try {
    const db = scoped(tenant.id);
    // Menu items validated INSIDE the tenant context: only this tenant's
    // available items match — a foreign menuItemId fails the length check.
    const ids = Array.from(new Set(items.map((i) => i.menuItemId)));
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: ids }, isAvailable: true },
    });
    if (menuItems.length !== ids.length) {
      throw new HttpError(422, "One or more menu items are unavailable");
    }

    const byId = new Map(menuItems.map((m) => [m.id, m]));
    const orderItems = items.map((i) => {
      const menuItem = byId.get(i.menuItemId)!;
      return {
        menuItemId: menuItem.id,
        quantity: i.quantity,
        unitPrice: menuItem.price, // snapshot price at order time
      };
    });

    const totalPrepSeconds = orderItems.reduce(
      (acc, oi) => acc + (byId.get(oi.menuItemId)?.prepTimeSeconds ?? 0) * oi.quantity,
      0
    );
    // Basic ETA (own prep + tenant buffer). Full FIFO queue ETA: T5.
    const etaSeconds = totalPrepSeconds + tenant.prepTimeBuffer * 60;

    const order = await db.order.create({
      data: {
        customerName,
        customerPhone,
        etaSeconds,
        etaCalculatedAt: new Date(),
        paymentMethod: paymentMethod as PaymentMethod | undefined,
        items: { create: orderItems },
        statusLogs: { create: { status: "PENDING", note: "Order created" } },
      } as unknown as Parameters<typeof prisma.order.create>[0]["data"],
      select: { id: true, status: true, etaSeconds: true },
    });

    return ok({ orderId: order.id, status: order.status, etaSeconds: order.etaSeconds }, 201);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }
}
