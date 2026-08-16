import Link from "next/link";
import { prisma } from "@/lib/db";
import { effectiveOpen } from "@/lib/open";
import { Logo } from "@/components/landing/Logo";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Features } from "@/components/landing/Features";
import { OwnerCta } from "@/components/landing/OwnerCta";
import { FinalCta } from "@/components/landing/FinalCta";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Modern marketing landing page for HeadwayBrew (T29, PLAN section 13).
 *
 * Server-rendered tenant list is reused for both discovery (shop search grid)
 * and live social proof (open shop counter). The page remains a thin server
 * component: sticky header, hero (with live search card), 3-step row, popular
 * shops placeholder, feature grid, owner CTA, final CTA, and footer are
 * server-rendered, while only the live search/filter grid is client-side.
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

  const openCount = tenants.reduce(
    (count, tenant) => (effectiveOpen(tenant) ? count + 1 : count),
    0,
  );

  return (
    <div className="relative min-h-screen w-full bg-background">
      {/* Sticky header (D11): logo + nav + CTA Pesan Sekarang + Daftar Kedai */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6 md:px-12">
          <Logo />
          <nav className="hidden items-center gap-8 md:flex">
            <Link
              href="#search-box"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Pesan
            </Link>
            <Link
              href="#how-it-works"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cara Kerja
            </Link>
            <Link
              href="#tentang"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Tentang
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/register"
              className="text-sm font-semibold text-primary transition-colors hover:text-primary/80"
            >
              Daftar Kedai
            </Link>
            <Button
              asChild
              size="lg"
              className="hidden h-auto rounded-full px-5 py-2.5 text-sm font-bold md:inline-flex"
            >
              <a href="#search-box">Pesan Sekarang</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <Hero openCount={openCount} tenants={tenants} />
        <HowItWorks />

        {/* T29-B: Kedai Paling Populer — data real (PopularShops) menyusul.
            D4: kosong → section disembunyikan oleh T29-B. */}
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
          </div>
        </section>

        <Features />
        <OwnerCta />
        <FinalCta />
      </main>

      <LandingFooter />
    </div>
  );
}
