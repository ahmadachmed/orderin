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

/** Buka/Tutup badge — layout per konsep landingpage2.html, token codebase. */
function StatusBadge({
  open,
  size,
}: {
  open: boolean;
  size: "lg" | "sm";
}) {
  return (
    <span
      className={`inline-block border font-bold uppercase tracking-wider ${
        size === "lg"
          ? "rounded-lg px-4 py-2 text-sm"
          : "rounded-md px-3 py-1 text-xs"
      } ${
        open
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground"
      }`}
    >
      {open ? "Buka" : "Tutup"}
    </span>
  );
}

/** Watermark rank — konsep landingpage2.html (big ghost numeral per card). */
function RankWatermark({
  rank,
  size,
}: {
  rank: number;
  size: "hero" | "square" | "inline";
}) {
  const cls =
    size === "hero"
      ? "absolute -right-10 -bottom-10 text-9xl"
      : size === "square"
        ? "absolute -right-4 -bottom-4 text-7xl"
        : "text-4xl";
  return (
    <span
      aria-hidden
      className={`${cls} select-none font-extrabold tabular-nums text-primary/5`}
    >
      #{rank}
    </span>
  );
}

/**
 * Kedai Paling Populer section (T29-2, konsep landingpage2.html).
 *
 * 12-col grid with auto-rows: rank #1 spans 8 (hero card, label
 * "Paling Diminati", big ghost #1 watermark), #2 spans 4 (square, ghost #2),
 * #3 spans 12 (wide row, inline #3). Every card links to /[slug]; the open
 * badge goes through the shared `effectiveOpen` (F8 — do NOT fork
 * open-state logic). Empty state D4: <3 shops render as-is, 0 shops →
 * section hidden.
 */
export default function PopularShops({ shops }: { shops: PopularShop[] }) {
  if (shops.length === 0) return null;

  return (
    <section
      id="popular"
      className="bg-muted/50 px-6 py-20 md:px-12"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-10 text-center md:text-left">
          <h2 className="mb-2 text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Kedai Paling Populer
          </h2>
          <p className="text-muted-foreground">
            Berdasarkan volume pesanan dalam 30 hari terakhir.
          </p>
        </div>

        <div className="grid auto-rows-[minmax(140px,auto)] grid-cols-1 gap-6 md:grid-cols-12">
          {shops.map((s, i) => {
            const open = effectiveOpen({
              isOpen: s.isOpen,
              openTime: s.openTime,
              closeTime: s.closeTime,
              isOpenOverrideUntil: s.isOpenOverrideUntil,
            });
            const rank = i + 1;
            const isTop = i === 0;
            const isWide = i >= 2;

            // Konsep landingpage2.html: #1 = col-span-8 (hero), #2 = col-span-4
            // (square), #3+ = col-span-12 (wide row).
            const span = isTop ? "md:col-span-8" : isWide ? "md:col-span-12" : "md:col-span-4";

            const base =
              "group relative overflow-hidden rounded-3xl border border-border bg-card transition-colors hover:border-primary/50";

            if (isWide) {
              return (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className={`${base} ${span} flex flex-row items-center justify-between gap-6 p-6 opacity-80 transition-all hover:opacity-100 md:p-8`}
                >
                  <div className="relative z-10 flex items-center gap-6">
                    <RankWatermark rank={rank} size="inline" />
                    <div className="flex flex-col">
                      <h3 className="text-xl font-bold text-foreground transition-colors group-hover:text-primary">
                        {s.name}
                      </h3>
                      {s.address ? (
                        <p className="text-sm text-muted-foreground">
                          {s.address}
                        </p>
                      ) : null}
                      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {s.orderCount} pesanan
                      </p>
                    </div>
                  </div>
                  <StatusBadge open={open} size="sm" />
                </Link>
              );
            }

            if (isTop) {
              return (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className={`${base} ${span} flex flex-col items-start justify-between gap-6 p-8 md:flex-row md:items-center`}
                >
                  <RankWatermark rank={rank} size="hero" />
                  <div className="relative z-10 flex flex-col">
                    <span className="mb-2 text-sm font-bold uppercase tracking-widest text-primary">
                      Paling Diminati
                    </span>
                    <h3 className="mb-2 text-3xl font-bold text-foreground transition-colors group-hover:text-primary">
                      {s.name}
                    </h3>
                    {s.address ? (
                      <p className="text-base text-muted-foreground">
                        {s.address}
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.orderCount} pesanan
                    </p>
                  </div>
                  <div className="relative z-10 self-start md:self-center">
                    <StatusBadge open={open} size="lg" />
                  </div>
                </Link>
              );
            }

            // #2 — square card, rank watermark bottom-right, badge bottom-left.
            return (
              <Link
                key={s.slug}
                href={`/${s.slug}`}
                className={`${base} ${span} flex flex-col justify-between p-8`}
              >
                <RankWatermark rank={rank} size="square" />
                <div className="relative z-10 mb-6 flex flex-col">
                  <h3 className="mb-2 text-2xl font-bold text-foreground transition-colors group-hover:text-primary">
                    {s.name}
                  </h3>
                  {s.address ? (
                    <p className="text-sm text-muted-foreground">{s.address}</p>
                  ) : null}
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.orderCount} pesanan
                  </p>
                </div>
                <div className="relative z-10 mt-auto self-start">
                  <StatusBadge open={open} size="sm" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
