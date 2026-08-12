import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { prisma } from "@/lib/db";
import { fetchQueue, etaForNewOrder, withBuffer } from "@/lib/queue";
import { formatTimeInTimezone } from "@/lib/time";
import { MenuItemView } from "@/types";
import QueueIndicator from "@/components/QueueIndicator";
import OrderForm from "@/components/OrderForm";
import ActiveOrderBanner from "@/components/ActiveOrderBanner";
import OrderLookupForm from "@/components/OrderLookupForm";

export const dynamic = "force-dynamic";

/** HH:mm UTC operating-hours check (provisional copy — T2 owns lib/time.ts). */
function isWithinHours(open: string, close: string, now: Date = new Date()): boolean {
  const hm = now.toISOString().slice(11, 16);
  if (open <= close) return hm >= open && hm < close;
  return hm >= open || hm < close; // wraps past midnight
}

/**
 * Shop menu page — /[tenantSlug] (PLAN §3.2 / issue #111).
 * Server-rendered: tenant + available items + queue estimate. OrderForm
 * (client) handles the cart and submits via POST /api/order (T2).
 *
 * P2 restyle (§3.2): sticky glass top bar (tenant name + Buka/Tutup status +
 * history icon), queue indicator above menu, MenuList cards + cart bottom
 * bar live inside OrderForm (T11). Layout shell keeps the pre-restyle
 * `bg-neutral-50` wrapper (shared with T15/T16 pages) — this page paints
 * its own `bg-background` over it (kanon is dark-first).
 *
 * Queue estimate: FIFO queue sum via lib/queue.ts (issue #6 / PLAN §4) —
 * Σ (prep_time × qty) of active orders + tenant buffer. This is the wait a
 * NEW order would face (own prep is added server-side at POST time).
 */
export default async function ShopMenuPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) notFound();

  const items = await prisma.menuItem.findMany({
    where: { tenantId: tenant.id, isAvailable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const menuItems: MenuItemView[] = items.map((it) => ({
    id: it.id,
    name: it.name,
    description: it.description,
    category: it.category ?? undefined,
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
    // -mx-4/-mt-4 cancel the shared layout's px-4 pt-4 so the dark page bg +
    // full-bleed sticky top bar span the whole column (kanon menu.html).
    <main className="-mx-4 -mt-4 min-h-screen bg-background pb-40">
      {/* Top bar — kanon menu.html: sticky glass, name + status + history */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/"
              aria-label="Kembali ke beranda"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="truncate text-lg font-bold tracking-tight text-foreground">
              {tenant.name}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={
                open
                  ? "rounded-lg border border-success/20 bg-success/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-success"
                  : "rounded-lg border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
              }
            >
              {open ? "Buka" : "Tutup"}
            </span>
            {/* T25 ITEM 1 (issue #167): manual order lookup entry point. */}
            <OrderLookupForm tenantSlug={tenantSlug} />
            <Link
              href={`/${tenant.slug}/account/orders`}
              aria-label="Riwayat pesanan"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <History className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {tenant.address ? (
          <p className="text-xs text-muted-foreground">{tenant.address}</p>
        ) : null}

        <ActiveOrderBanner tenantSlug={tenantSlug} />

        {/* Queue estimate above the menu (PLAN §3.2) */}
        <QueueIndicator queueSeconds={queueSeconds} isOpen={open} />

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
