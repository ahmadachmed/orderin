/**
 * GET /api/order/[orderId] — public order status + ETA + payment details.
 * PLAN §9.1 / §3.2. Lookup is intentionally unscoped: the orderId UUID is the
 * customer's bearer token (status page). Tenant payment details come along so
 * the status page can render QRIS / bank transfer instructions.
 *
 * ETA semantics (issue #6 / PLAN §4): duration in seconds. READY_FOR_PICKUP
 * → 0 (coffee is ready); PICKED_UP / CANCELLED → null (no wait). Stored
 * etaSeconds is kept fresh by POST (new order) and PATCH (recalc on queue
 * leave); pre-T5 rows with a missing ETA get a live fallback computation.
 */
import { NextRequest } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { fetchQueue, etaForOrderInQueue, prepSecondsForItems, withBuffer } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { orderId: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: {
      items: {
        include: { menuItem: { select: { name: true, prepTimeSeconds: true } } },
      },
      tenant: {
        select: {
          name: true,
          slug: true,
          prepTimeBuffer: true,
          qrisCode: true,
          qrisImageUrl: true,
          bankAccountNumber: true,
          bankName: true,
        },
      },
      statusLogs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          actorType: true,
          actorName: true,
          note: true,
          createdAt: true,
        },
      },
    },
  });

  if (!order) return fail("Order not found", 404);

  const status = String(order.status);
  let etaSeconds: number | null = order.etaSeconds;
  if (status === "READY_FOR_PICKUP") {
    etaSeconds = 0; // coffee is ready — no wait
  } else if (status === "PICKED_UP" || status === "CANCELLED") {
    etaSeconds = null; // done / cancelled — no ETA
  } else if (etaSeconds === null || etaSeconds === undefined) {
    // Pre-T5 row without a stored ETA: compute live from the current queue.
    const queue = await fetchQueue(scoped(order.tenantId), order.tenantId);
    const ahead = etaForOrderInQueue(queue, order.id);
    const own = prepSecondsForItems(order.items);
    etaSeconds = withBuffer(ahead ?? own, order.tenant.prepTimeBuffer);
  }

  return ok({
    orderId: order.id,
    status,
    etaSeconds,
    etaCalculatedAt: order.etaCalculatedAt,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    paidAt: order.paidAt,
    customerTransferNote: order.customerTransferNote,
    createdAt: order.createdAt,
    customerName: order.customerName,
    items: order.items.map((oi) => ({
      name: oi.menuItem.name,
      quantity: oi.quantity,
      unitPrice: oi.unitPrice,
      prepTimeSeconds: oi.menuItem.prepTimeSeconds,
    })),
    total: order.items.reduce(
      (acc, oi) => acc + Number(oi.unitPrice) * oi.quantity,
      0
    ),
    statusLogs: order.statusLogs.map((l) => ({
      id: l.id,
      status: l.status,
      actorType: l.actorType,
      actorName: l.actorName,
      note: l.note,
      createdAt: l.createdAt,
    })),
    tenant: order.tenant,
  });
}
