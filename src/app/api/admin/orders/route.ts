/**
 * GET /api/admin/orders — active orders for the admin's tenant
 * (PENDING → READY_FOR_PICKUP, FIFO by createdAt). PLAN §9.2.
 */
import { scoped } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { OrderStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.BREWING,
  OrderStatus.READY_FOR_PICKUP,
];

export async function GET() {
  const session = getSession();
  if (!session) return fail("Unauthorized", 401);

  const orders = await scoped(session.tenantId).order.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "asc" },
    include: {
      items: {
        include: { menuItem: { select: { name: true } } },
      },
      statusLogs: { orderBy: { createdAt: "asc" } },
    },
  });

  return ok({
    orders: orders.map((o) => ({
      id: o.id,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      etaSeconds: o.etaSeconds,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      items: o.items.map((oi) => ({
        id: oi.id,
        name: oi.menuItem.name,
        quantity: oi.quantity,
        unitPrice: oi.unitPrice,
      })),
      total: o.items.reduce((acc, oi) => acc + Number(oi.unitPrice) * oi.quantity, 0),
      statusLogs: o.statusLogs.map((l) => ({
        id: l.id,
        status: l.status,
        note: l.note,
        createdAt: l.createdAt,
      })),
    })),
  });
}
