/**
 * GET /api/order/[orderId] — public order status + ETA + payment details.
 * PLAN §9.1 / §3.2. Lookup is intentionally unscoped: the orderId UUID is the
 * customer's bearer token (status page). Tenant payment details come along so
 * the status page can render QRIS / bank transfer instructions.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";

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
          qrisCode: true,
          qrisImageUrl: true,
          bankAccountNumber: true,
          bankName: true,
        },
      },
    },
  });

  if (!order) return fail("Order not found", 404);

  return ok({
    orderId: order.id,
    status: order.status,
    etaSeconds: order.etaSeconds,
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
    tenant: order.tenant,
  });
}
