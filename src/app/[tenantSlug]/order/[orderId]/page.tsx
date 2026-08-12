import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCustomerSession } from "@/lib/customer-auth";
import { isValidUuid } from "@/lib/uuid";
import { QUEUE_STATUSES, fetchQueue, queuePositionForOrder } from "@/lib/queue";
import { OrderStatusView } from "@/types";
import OrderStatusTracker from "@/components/OrderStatusTracker";
import OrderPersistence from "@/components/OrderPersistence";

export const dynamic = "force-dynamic";

/**
 * Order status page — /[tenantSlug]/order/[orderId] (PLAN §3.3 / issue #112).
 * Initial render is server-side (unscoped UUID lookup, like T2's
 * GET /api/order/[orderId]); the client tracker then polls that endpoint
 * every 5s for live status/ETA/payment updates.
 *
 * Page chrome matches Stitch mobile/status.html: sticky top bar with back
 * arrow + centered "Status Pesanan", content column max-w-[390px].
 */
export default async function OrderStatusPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; orderId: string }>;
}) {
  const { tenantSlug, orderId } = await params;

  // Issue #135: non-UUID orderId would make Prisma throw (invalid input
  // syntax for type uuid) → 500. Format-check before any DB call → 404.
  if (!isValidUuid(orderId)) notFound();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
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
  if (!order || order.tenant.slug !== tenantSlug) notFound();

  // T17-7: guest orders get the "Buat akun" banner — logged-in customers see
  // no banner, so the phone (banner trigger) is nulled out for them.
  const customerSession = await getCustomerSession();

  // T19 / issue #147: 1-based FIFO queue position for the initial render
  // (polling keeps it fresh afterwards). Only queue statuses have a position.
  const queueStatus = String(order.status);
  let queuePosition: number | null = null;
  if ((QUEUE_STATUSES as readonly string[]).includes(queueStatus)) {
    const queue = await fetchQueue(prisma, order.tenantId);
    queuePosition = queuePositionForOrder(queue, order.id);
  }

  const view: OrderStatusView = {
    orderId: order.id,
    status: order.status,
    etaSeconds: order.etaSeconds,
    queuePosition,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    customerTransferNote: order.customerTransferNote,
    pickupCode: order.pickupCode || null,
    createdAt: order.createdAt.toISOString(),
    customerName: order.customerName,
    customerPhone: customerSession ? null : order.customerPhone,
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
    <main className="flex min-h-screen flex-col bg-background">
      {/* Top bar — Stitch status.html: back arrow + centered "Status Pesanan" */}
      <header className="sticky top-0 z-50 flex h-16 w-full items-center border-b border-border bg-background px-4">
        <Link
          href={`/${order.tenant.slug}`}
          aria-label="Kembali ke menu"
          className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="mr-9 flex-1 text-center text-xl font-bold tracking-tight text-foreground">
          Status Pesanan
        </h1>
      </header>

      {/* Content column — max-w-[390px] mobile canvas, centered */}
      <div className="mx-auto flex w-full max-w-[390px] flex-1 flex-col gap-6 px-4 py-6 pb-8">
        <OrderPersistence orderId={order.id} slug={order.tenant.slug} />
        <OrderStatusTracker initial={view} />
      </div>
    </main>
  );
}
