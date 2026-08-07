import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { fetchQueue, etaForNewOrder, withBuffer } from "@/lib/queue";
import { formatTimeInTimezone } from "@/lib/time";
import { MenuItemView } from "@/types";
import QueueIndicator from "@/components/QueueIndicator";
import OrderForm from "@/components/OrderForm";
import ActiveOrderBanner from "@/components/ActiveOrderBanner";

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
 * Queue estimate: FIFO queue sum via lib/queue.ts (issue #6 / PLAN §4) —
 * Σ (prep_time × qty) of active orders + tenant buffer. This is the wait a
 * NEW order would face (own prep is added server-side at POST time).
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

  // Queue estimate for a new order: everything currently in the FIFO queue
  // (PENDING/CONFIRMED/BREWING) + tenant buffer (PLAN §4, issue #6).
  const queue = await fetchQueue(prisma, tenant.id);
  const queueSeconds = withBuffer(etaForNewOrder(queue, 0), tenant.prepTimeBuffer);

  const open = tenant.isOpen && isWithinHours(tenant.openTime, tenant.closeTime);
  // SETTINGS-05: show operating hours in the tenant's timezone (default
  // Asia/Jakarta when unset), not raw UTC.
  const timezone = tenant.timezone || "Asia/Jakarta";
  const openDisplay = formatTimeInTimezone(tenant.openTime, timezone);
  const closedMessage = tenant.isOpen
    ? `Kedai tutup — buka kembali pukul ${openDisplay} (${timezone}).`
    : "Kedai sedang tutup — pesanan belum bisa diterima.";

  return (
    <main className="pb-10">
      <ActiveOrderBanner tenantSlug={params.tenantSlug} />
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
