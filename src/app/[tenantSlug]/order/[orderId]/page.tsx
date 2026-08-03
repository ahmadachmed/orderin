import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { OrderStatusView } from "@/types";
import OrderStatusTracker from "@/components/OrderStatusTracker";

export const dynamic = "force-dynamic";

/**
 * Order status page — /[tenantSlug]/order/[orderId] (PLAN §8 / issue #4).
 * Initial render is server-side (unscoped UUID lookup, like T2's
 * GET /api/order/[orderId]); the client tracker then polls that endpoint
 * every 5s for live status/ETA/payment updates.
 */
export default async function OrderStatusPage({
  params,
}: {
  params: { tenantSlug: string; orderId: string };
}) {
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

  // UUID is unguessable (bearer token), but still verify the slug matches
  // the URL so cross-tenant URLs 404 instead of leaking order data.
  if (!order || order.tenant.slug !== params.tenantSlug) notFound();

  const view: OrderStatusView = {
    orderId: order.id,
    status: order.status,
    etaSeconds: order.etaSeconds,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    customerTransferNote: order.customerTransferNote,
    createdAt: order.createdAt.toISOString(),
    customerName: order.customerName,
    items: order.items.map((oi) => ({
      name: oi.menuItem.name,
      quantity: oi.quantity,
      unitPrice: Number(oi.unitPrice),
      prepTimeSeconds: oi.menuItem.prepTimeSeconds,
    })),
    total: order.items.reduce((acc, oi) => acc + Number(oi.unitPrice) * oi.quantity, 0),
    tenant: {
      name: order.tenant.name,
      slug: order.tenant.slug,
      qrisCode: order.tenant.qrisCode,
      qrisImageUrl: order.tenant.qrisImageUrl,
      bankAccountNumber: order.tenant.bankAccountNumber,
      bankName: order.tenant.bankName,
    },
  };

  return (
    <main className="pb-10">
      <header className="mb-4">
        <Link
          href={`/${order.tenant.slug}`}
          className="text-xs font-medium text-neutral-400 hover:text-neutral-600"
        >
          ← Kembali ke menu
        </Link>
        <h1 className="mt-1 text-xl font-extrabold tracking-tight text-neutral-900">
          {order.tenant.name}
        </h1>
      </header>

      <OrderStatusTracker initial={view} />
    </main>
  );
}
