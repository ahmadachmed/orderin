import Link from "next/link";
import { prisma } from "@/lib/db";
import { TenantSummary } from "@/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ShopSearchForm from "@/components/ShopSearchForm";

export const dynamic = "force-dynamic";

/**
 * Landing page — shop list (PLAN §8 / issue #4).
 * Server-rendered from DB: there is no public "list tenants" endpoint in
 * §9.1, so the landing page reads directly (unscoped Tenant lookup).
 * Restyle per PLAN §3.1 + kanon mobile/beranda.html — className/structure
 * only; props, handlers, and Indonesian labels unchanged (E2E contract).
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

      {/* Search / Slug Input Card (kanon beranda.html) */}
      <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-lg">
        <ShopSearchForm />
      </section>

      {/* Tenant Grid */}
      {tenants.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Belum ada kedai terdaftar.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tenants.map((t: TenantSummary) => (
            <li key={t.slug}>
              <Link href={`/${t.slug}`} className="block">
                <Card className="p-4 transition active:scale-[0.99]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-bold text-foreground">{t.name}</h2>
                      {t.address ? (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">{t.address}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Buka {t.openTime}–{t.closeTime} UTC · {t.phone ?? "—"}
                      </p>
                    </div>
                    <Badge
                      className={`shrink-0 ${
                        t.isOpen
                          ? "border-success/20 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {t.isOpen ? "Buka" : "Tutup"}
                    </Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Secondary Action (kanon beranda.html) */}
      <section className="text-center">
        <Link
          href="/register"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Pemilik kedai? Masuk
        </Link>
      </section>
    </main>
  );
}
