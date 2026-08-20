import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PRO_PRICE_IDR } from "@/lib/billing";
import { Logo } from "@/components/landing/Logo";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Monetisation Phase 3 / T19 — public pricing page (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §8.1.
 *
 * Rp99.000/bulan + PRO benefits. CTA routing: logged-in admin → their
 * settings billing section; otherwise → /login (which lands them on the
 * dashboard after sign-in).
 */

const PRO_BENEFITS: Array<{ title: string; detail: string }> = [
  { title: "Menu tanpa batas", detail: "Bebas dari batas 25 item menu" },
  { title: "Order tanpa batas", detail: "Bebas dari kuota 300 order/bulan" },
  { title: "Antrean hingga 100 order", detail: "Kapasitas antrean maksimal" },
  { title: "Retensi sprint 30 hari", detail: "Riwayat penjualan lebih panjang" },
  { title: "Tanpa badge", detail: "Shopfront bersih tanpa \"Powered by HeadwayBrew\"" },
  { title: "Prioritas support", detail: "Bantuan lebih cepat saat dibutuhkan" },
];

const priceLabel = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format(PRO_PRICE_IDR);

export default async function PricingPage() {
  // CTA routing: an active admin session → that tenant's billing section.
  const session = await getSession();
  let slug: string | null = null;
  if (session) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { slug: true },
    });
    slug = tenant?.slug ?? null;
  }
  const ctaHref = session && slug ? `/admin/${slug}/settings?billing=1` : "/login";

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6 md:px-12">
          <Logo />
          <nav className="flex items-center gap-6">
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Beranda
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold text-primary transition-colors hover:text-primary/80"
            >
              Daftar Kedai
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            HeadwayBrew PRO
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground">
            {priceLabel}
            <span className="text-lg font-medium text-muted-foreground"> /bulan</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            Semua fitur untuk kedai kopi yang siap tumbuh — tanpa batas menu, tanpa
            batas order, tanpa badge. Batalkan kapan saja (tagihan bulanan berhenti otomatis).
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Termasuk di PRO
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="pro-benefits">
            {PRO_BENEFITS.map((benefit) => (
              <li key={benefit.title} className="flex items-start gap-2.5">
                <span className="mt-0.5 rounded-full bg-emerald-500/15 p-1 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="text-sm text-foreground">
                  <span className="font-semibold">{benefit.title}</span>
                  <span className="block text-xs text-muted-foreground">{benefit.detail}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8 border-t border-border pt-6 text-center">
            <Button asChild size="lg" className="w-full rounded-full font-bold sm:w-auto sm:px-10">
              <Link href={ctaHref} data-testid="pricing-cta">
                Upgrade sekarang
              </Link>
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Pembayaran aman via Duitku — QRIS, VA, e-wallet, atau kartu.
            </p>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
