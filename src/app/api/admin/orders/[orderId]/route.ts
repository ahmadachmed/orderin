/**
 * PATCH /api/admin/orders/[orderId] — update status and/or payment.
 * PLAN §9.2 + §3.1 state machine:
 *   pending → confirmed | cancelled (cancelled ONLY from pending)
 *   confirmed → brewing   (payment gate: must be PAID)
 *   brewing → ready_for_pickup
 *   ready_for_pickup → picked_up
 * Payment tracked independently (UNPAID → PAID, §3.1.1); marking PAID stores
 * paidAt + paymentMethod. Status changes append OrderStatusLog entries.
 */
import { NextRequest } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, HttpError, readJson } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { OrderStatus, PaymentStatus, PaymentMethod } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const ALLOWED_TRANSITIONS: Record<string, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.BREWING],
  [OrderStatus.BREWING]: [OrderStatus.READY_FOR_PICKUP],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.PICKED_UP],
  [OrderStatus.PICKED_UP]: [],
  [OrderStatus.CANCELLED]: [],
};

const PAYMENT_METHODS = new Set<string>(["qris", "bank_transfer", "cash"]);

function assertTransition(current: OrderStatus, next: OrderStatus) {
  if (current === next) throw new HttpError(422, `Order is already ${current}`);
  if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
    throw new HttpError(422, `Invalid status transition ${current} → ${next}`);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const session = getSession();
  if (!session) return fail("Unauthorized", 401);

  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body", 400);

  const rawStatus = body.status === undefined ? undefined : String(body.status);
  const rawPayment = body.paymentStatus === undefined ? undefined : String(body.paymentStatus);
  const rawMethod = body.paymentMethod === undefined ? undefined : String(body.paymentMethod);
  const note = typeof body.note === "string" ? body.note : undefined;

  if (rawPayment !== undefined && rawPayment !== "PAID" && rawPayment !== "UNPAID") {
    return fail("paymentStatus must be PAID or UNPAID", 400);
  }
  if (rawMethod !== undefined && !PAYMENT_METHODS.has(rawMethod)) {
    return fail("paymentMethod must be qris, bank_transfer or cash", 400);
  }

  try {
    const db = scoped(session.tenantId);
    const order = await db.order.findFirst({ where: { id: params.orderId } });
    if (!order) throw new HttpError(404, "Order not found");

    // Barista identity for the audit log (issue #7: who marked paid).
    const admin = await db.tenantAdmin.findFirst({ where: { id: session.adminId } });
    const actorName = admin?.username ?? "barista";

    const data: Record<string, unknown> = {};
    let nextStatus: OrderStatus | undefined;
    let paymentChanged: "PAID" | "UNPAID" | undefined;

    if (rawPayment === "PAID") {
      data.paymentStatus = PaymentStatus.PAID;
      data.paidAt = new Date();
      if (rawMethod !== undefined) data.paymentMethod = rawMethod as PaymentMethod;
      paymentChanged = "PAID";
    } else if (rawPayment === "UNPAID") {
      data.paymentStatus = PaymentStatus.UNPAID;
      data.paidAt = null;
      data.paymentMethod = null;
      paymentChanged = "UNPAID";
    }

    if (rawStatus !== undefined) {
      nextStatus = rawStatus as OrderStatus;
      if (!Object.values(OrderStatus).includes(nextStatus)) {
        throw new HttpError(422, "Invalid status value");
      }
      assertTransition(order.status, nextStatus);
      // Payment gate (§3.1.1): cannot start brewing until PAID.
      const effectivePayment =
        data.paymentStatus === undefined ? order.paymentStatus : data.paymentStatus;
      if (nextStatus === OrderStatus.BREWING && effectivePayment !== PaymentStatus.PAID) {
        throw new HttpError(409, "Payment must be PAID before order can brew");
      }
      data.status = nextStatus;
    }

    if (Object.keys(data).length === 0) {
      throw new HttpError(422, "Nothing to update — send status and/or paymentStatus");
    }

    const res = (await db.order.update({
      where: { id: order.id },
      data,
    })) as unknown as { count: number };
    if (res.count === 0) throw new HttpError(404, "Order not found");

    if (nextStatus) {
      await prisma.orderStatusLog.create({
        data: {
          orderId: order.id,
          status: nextStatus,
          actorType: "BARISTA",
          actorName,
          note: note ?? null,
        },
      });
    }

    // Audit log for payment events (issue #7): who marked the order paid.
    if (paymentChanged) {
      await prisma.orderStatusLog.create({
        data: {
          orderId: order.id,
          status: nextStatus ?? order.status,
          paymentStatus: paymentChanged,
          actorType: "BARISTA",
          actorName,
          note:
            paymentChanged === "PAID"
              ? note ?? `Marked PAID via ${rawMethod ?? "dashboard"}`
              : note ?? "Marked UNPAID",
        },
      });
    }

    const updated = await db.order.findFirst({
      where: { id: order.id },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        statusLogs: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!updated) throw new HttpError(404, "Order not found");

    return ok({
      id: updated.id,
      customerName: updated.customerName,
      customerPhone: updated.customerPhone,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      paymentMethod: updated.paymentMethod,
      paidAt: updated.paidAt,
      customerTransferNote: updated.customerTransferNote,
      etaSeconds: updated.etaSeconds,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      items: updated.items.map((oi) => ({
        id: oi.id,
        name: oi.menuItem.name,
        quantity: oi.quantity,
        unitPrice: oi.unitPrice,
      })),
      total: updated.items.reduce((acc, oi) => acc + Number(oi.unitPrice) * oi.quantity, 0),
      statusLogs: updated.statusLogs.map((l) => ({
        id: l.id,
        status: l.status,
        paymentStatus: l.paymentStatus,
        actorType: l.actorType,
        actorName: l.actorName,
        note: l.note,
        createdAt: l.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }
}
