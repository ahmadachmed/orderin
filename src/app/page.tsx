import { prisma } from "@/lib/db";
import ShopSearchForm from "@/components/ShopSearchForm";

export const dynamic = "force-dynamic";

/**
 * Landing page — shop list (PLAN §8 / issue #4).
 * Server-rendered from DB: there is no public "list tenants" endpoint in
 * §9.1, so the landing page reads directly (unscoped Tenant lookup).
 * Issue #142: the tenant grid + live search filter now live inside
 * ShopSearchForm (client) — this page keeps the server-side data fetch and
 * passes the tenants down as a prop, so initial markup is still server-
 * rendered from the DB.
 */
export default async function Home() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      address: true,
      phone: true,
      isOpen: true,
      openTime: true,
      closeTime: true,
      timezone: true,
      isOpenOverrideUntil: true,
    },
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[390px] flex-col gap-10 px-6 pb-12 pt-10">
      {/* Hero Section (kanon beranda.html) */}
      <section className="flex flex-col gap-4">
        <h1 className="text-[32px] leading-[1.15] font-extrabold tracking-tight text-foreground">
          Orderin
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Pesan kopi lebih dulu, ambil saat sudah siap — tanpa antre.
        </p>
      </section>

      {/* Lacak Pesanan CTA (T25 ITEM 1 / issue #167) — scrolls to the shop
          search grid below; the actual lookup entry point lives in each shop
          header (OrderLookupForm) since the API is tenant-scoped. */}
      <section className="flex flex-col gap-1">
        <a
          href="#shop-search"
          className="text-sm font-semibold text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
        >
          Lacak Pesanan
        </a>
        <p className="text-xs text-muted-foreground">
          Cari kedai lalu gunakan tombol Lacak di halaman kedai.
        </p>
      </section>

      {/* Search card + tenant grid (filtered live by the query) */}
      <ShopSearchForm tenants={tenants} />

    </main>
  );
}
