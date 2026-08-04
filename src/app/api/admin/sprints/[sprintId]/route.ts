/**
 * GET /api/admin/sprints/[sprintId] — detail of one sprint: header fields,
 * order count, on-the-fly revenue (Σ PAID) and the full order list
 * (items + statusLogs, FIFO by createdAt) — PLAN §2.1/§2.3.
 */
import { NextRequest } from "next/server";
import { scoped } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { PaymentStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { sprintId: string } }
) {
  const session = getSession();
  if (!session) return fail("Unauthorized", 401);

  const db = scoped(session.tenantId);
  const sprint = await db.sprint.findFirst({
    where: { id: params.sprintId },
    include: {
      _count: { select: { orders: true } },
      orders: {
        orderBy: { createdAt: "asc" },
        include: {
          items: { include: { menuItem: { select: { name: true } } } },
          statusLogs: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!sprint) return fail("Sprint not found", 404);

  // Omzet sprint (Σ PAID) — on-the-fly from the fetched orders (PLAN §2.3).
  const revenue = sprint.orders
    .filter((o) => o.paymentStatus === PaymentStatus.PAID)
    .reduce(
      (acc, o) =>
        acc +
        o.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0),
      0
    );

  return ok({
    sprint: {
      id: sprint.id,
      startAt: sprint.startAt,
      endAt: sprint.endAt,
      status: sprint.status,
      closedAt: sprint.closedAt,
      createdAt: sprint.createdAt,
      orderCount: sprint._count.orders,
      revenue,
    },
    orders: sprint.orders.map((o) => ({
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
