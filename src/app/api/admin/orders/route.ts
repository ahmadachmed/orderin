/**
 * GET /api/admin/orders — active orders for the admin's tenant
 * (PENDING → READY_FOR_PICKUP, FIFO by createdAt). PLAN §9.2 / T15 §2.2.
 * Board now shows only orders from the tenant's OPEN sprint plus legacy
 * orders without a sprintId (created before the sprint migration).
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

  const db = scoped(session.tenantId);

  // T15 §2.2: board shows the OPEN sprint's orders + legacy orders that
  // predate the sprint migration (sprintId = null). If no sprint is OPEN,
  // only legacy orders are shown (sprintId: "" matches nothing).
  const activeSprint = await db.sprint.findFirst({
    where: { status: "OPEN" },
    select: { id: true },
  });

  const orders = await db.order.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      OR: [
        { sprintId: activeSprint?.id ?? "" },
        { sprintId: null }, // legacy orders without a sprint
      ],
    },
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
      paidAt: o.paidAt,
      customerTransferNote: o.customerTransferNote,
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
        paymentStatus: l.paymentStatus,
        actorType: l.actorType,
        actorName: l.actorName,
        note: l.note,
        createdAt: l.createdAt,
      })),
    })),
  });
}
