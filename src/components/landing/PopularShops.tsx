import Link from "next/link";
import { effectiveOpen } from "@/lib/open";
import type { PrismaClient } from "@/generated/prisma/client";

/** One entry of the Kedai Paling Populer grid (ranked by order volume). */
export interface PopularShop {
  slug: string;
  name: string;
  address: string | null;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  timezone: string;
  isOpenOverrideUntil: Date | string | null;
  orderCount: number;
}

const WINDOW_DAYS = 30;
const TAKE = 3;

/**
 * T29-2 / D3 — server-side popular-shops query (RSC, no new endpoint).
 *
 * Top 3 tenants by order volume in the last 30 days, CANCELLED excluded,
 * then joined with the tenant row (name/slug/address/open-state fields).
 * Rank order = groupBy desc order. Groups whose tenant no longer exists are
 * dropped (defensive join, never fabricate a card).
 */
export async function getPopularShops(
  prisma: Pick<PrismaClient, "order" | "tenant">,
  now: Date = new Date(),
): Promise<PopularShop[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const groups = await prisma.order.groupBy({
    by: ["tenantId"],
    where: {
      createdAt: { gte: since },
      status: { not: "CANCELLED" },
    },
    _count: { _all: true },
    orderBy: { _count: { tenantId: "desc" } },
    take: TAKE,
  });

  if (groups.length === 0) return [];

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: groups.map((g) => g.tenantId) } },
    select: {
      id: true,
      slug: true,
      name: true,
      address: true,
      isOpen: true,
      openTime: true,
      closeTime: true,
      timezone: true,
      isOpenOverrideUntil: true,
    },
  });

  const byId = new Map(tenants.map((t) => [t.id, t]));

  return groups.flatMap((g) => {
    const tenant = byId.get(g.tenantId);
    if (!tenant) return [];
    const { id: _id, ...fields } = tenant;
    return [{ ...fields, orderCount: g._count._all }];
  });
}

/**
 * Kedai Paling Populer section (T29-2, konsep landingpage2.html).
 *
 * 12-col grid: rank #1 spans half (md:col-span-6, label "Paling Diminati"),
 * #2/#3 take md:col-span-3 each. Every card links to /[slug]; the open badge
 * goes through the shared `effectiveOpen` (F8 — do NOT fork open-state
 * logic). Empty state D4: <3 shops render as-is, 0 shops → section hidden.
 */
export default function PopularShops({ shops }: { shops: PopularShop[] }) {
  if (shops.length === 0) return null;

  return (
    <section
      id="popular"
      className="bg-muted/50 px-6 py-16 md:px-12 md:py-20"
    >
      <div className="mx-auto max-w-[1200px]">
        <h2 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
          Kedai Paling Populer
        </h2>
        <p className="mt-2 text-muted-foreground">
          Berdasarkan volume pesanan dalam 30 hari terakhir.
        </p>

        <div className="mt-10 grid grid-cols-12 gap-4 md:gap-6">
          {shops.map((s, i) => {
            const isTop = i === 0;
            const open = effectiveOpen({
              isOpen: s.isOpen,
              openTime: s.openTime,
              closeTime: s.closeTime,
              isOpenOverrideUntil: s.isOpenOverrideUntil,
            });
            return (
              <Link
                key={s.slug}
                href={`/${s.slug}`}
                className={`group col-span-12 rounded-2xl border border-border bg-card p-6 transition hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${
                  isTop ? "md:col-span-6" : "md:col-span-3"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                      isTop
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isTop ? "Paling Diminati" : `Peringkat ${i + 1}`}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      open
                        ? "border-success/20 bg-success/10 text-success"
                        : "border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    {open ? "Buka" : "Tutup"}
                  </span>
                </div>

                <h3 className="mt-4 truncate text-lg font-extrabold text-foreground group-hover:text-primary">
                  {s.name}
                </h3>
                {s.address ? (
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {s.address}
                  </p>
                ) : null}
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {s.orderCount} pesanan
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
