import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { MenuItemView } from "@/types";
import QueueIndicator from "@/components/QueueIndicator";
import OrderForm from "@/components/OrderForm";

export const dynamic = "force-dynamic";

/** HH:mm UTC operating-hours check (provisional copy — T2 owns lib/time.ts). */
function isWithinHours(open: string, close: string, now: Date = new Date()): boolean {
  const hm = now.toISOString().slice(11, 16);
  if (open <= close) return hm >= open && hm < close;
  return hm >= open || hm < close; // wraps past midnight
}

/**
 * Shop menu page — /[tenantSlug] (PLAN §8 / issue #4).
 * Server-rendered: tenant + available items + queue estimate. OrderForm
 * (client) handles the cart and submits via POST /api/order (T2).
 *
 * Queue estimate: provisional FIFO sum (prep_time × qty of active orders +
 * tenant buffer). T5 (issue #6) will formalize this in lib/queue.ts.
 */
export default async function ShopMenuPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: params.tenantSlug } });
  if (!tenant) notFound();

  const items = await prisma.menuItem.findMany({
    where: { tenantId: tenant.id, isAvailable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const menuItems: MenuItemView[] = items.map((it) => ({
    id: it.id,
    name: it.name,
    description: it.description,
    price: Number(it.price),
    imageUrl: it.imageUrl,
    prepTimeSeconds: it.prepTimeSeconds,
    sortOrder: it.sortOrder,
  }));

  // Provisional queue estimate: active orders (PENDING/CONFIRMED/BREWING).
  const activeOrders = await prisma.order.findMany({
    where: {
      tenantId: tenant.id,
      status: { in: ["PENDING", "CONFIRMED", "BREWING"] },
    },
    include: {
      items: {
        include: { menuItem: { select: { prepTimeSeconds: true } } },
      },
    },
  });
  const activePrepSeconds = activeOrders.reduce(
    (acc, o) =>
      acc +
      o.items.reduce(
        (s, oi) => s + oi.quantity * oi.menuItem.prepTimeSeconds,
        0
      ),
    0
  );
  const queueSeconds = activePrepSeconds + tenant.prepTimeBuffer * 60;

  const open = tenant.isOpen && isWithinHours(tenant.openTime, tenant.closeTime);
  const closedMessage = tenant.isOpen
    ? `Kedai tutup — buka kembali pukul ${tenant.openTime} UTC.`
    : "Kedai sedang tutup — pesanan belum bisa diterima.";

  return (
    <main className="pb-10">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link
            href="/"
            className="text-xs font-medium text-neutral-400 hover:text-neutral-600"
          >
            ← Semua kedai
          </Link>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-neutral-900">
            {tenant.name}
          </h1>
          {tenant.address ? (
            <p className="mt-0.5 text-xs text-neutral-500">{tenant.address}</p>
          ) : null}
        </div>
      </header>

      <QueueIndicator queueSeconds={queueSeconds} isOpen={open} />

      <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">Menu</h2>
        <OrderForm
          tenantSlug={tenant.slug}
          items={menuItems}
          isOpen={open}
          closedMessage={closedMessage}
        />
      </div>
    </main>
  );
}
