import Link from "next/link";
import { Check, CreditCard, HelpCircle, Sparkles } from "lucide-react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PRO_PRICE_IDR } from "@/lib/billing";
import { Logo } from "@/components/landing/Logo";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Monetisation Phase 3 / T19 + UX polish (issue #257) — public pricing page.
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §8.1.
 *
 * Rp99.000/bulan + PRO benefits vs FREE. Payment methods (QRIS / transfer
 * bank) without naming the gateway in user-facing copy. CTA routing:
 * logged-in admin → their settings billing section; otherwise → /login
 * (which lands them on the dashboard after sign-in). FAQ for the three
 * common questions.
 */

const PRO_BENEFITS: Array<{ title: string; detail: string }> = [
  { title: "Menu tanpa batas", detail: "Bebas dari batas 25 item menu" },
  { title: "Order tanpa batas", detail: "Bebas dari kuota 300 order/bulan" },
  { title: "Antrean hingga 100 order", detail: "Kapasitas antrean maksimal" },
  { title: "Retensi sprint 30 hari", detail: "Riwayat penjualan lebih panjang" },
  { title: "Tanpa badge", detail: "Shopfront bersih tanpa \"Powered by HeadwayBrew\"" },
  { title: "Prioritas support", detail: "Bantuan lebih cepat saat dibutuhkan" },
];

const FREE_LIMITS: Array<{ title: string; detail: string }> = [
  { title: "25 item menu", detail: "Cukup untuk menu harian kecil" },
  { title: "300 order/bulan", detail: "Kuota bulanan terbatas" },
  { title: "Antrean 20 order", detail: "Kapasitas antrean standar" },
  { title: "Retensi sprint 1 hari", detail: "Riwayat penjualan singkat" },
  { title: "Badge HeadwayBrew", detail: "Tampil di shopfront publik" },
];

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Apakah bisa coba gratis?",
    a: "Ya. Semua kedai mulai di paket FREE tanpa biaya — buat menu, terima order, dan kelola antrean langsung. Upgrade ke PRO hanya saat kedai sudah siap tumbuh.",
  },
  {
    q: "Bagaimana cara bayar?",
    a: "Pembayaran via QRIS atau transfer bank (virtual account). Setelah membayar, paket PRO aktif otomatis untuk 30 hari dan diperpanjang setiap bulan selama langganan aktif.",
  },
  {
    q: "Bisa berhenti kapan saja?",
    a: "Bisa. Batalkan langganan kapan saja dari halaman billing — tagihan bulan berikutnya berhenti otomatis dan kedai kembali ke paket FREE.",
  },
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

          {/* FREE vs PRO — what stays the same vs what changes */}
          <div className="mt-8 border-t border-border pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Bandingkan dengan FREE
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2" data-testid="plan-comparison">
              <div className="rounded-xl border border-border bg-background p-4">
                <p className="text-sm font-semibold text-foreground">FREE</p>
                <p className="text-xs text-muted-foreground">Gratis selamanya</p>
                <ul className="mt-3 space-y-2">
                  {FREE_LIMITS.map((f) => (
                    <li key={f.title} className="flex items-start gap-2 text-sm text-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span>
                        <span className="font-medium">{f.title}</span>
                        <span className="block text-xs text-muted-foreground">{f.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-sm font-semibold text-foreground">PRO — {priceLabel}/bulan</p>
                <p className="text-xs text-muted-foreground">Tanpa batas, tanpa badge</p>
                <ul className="mt-3 space-y-2">
                  {PRO_BENEFITS.map((b) => (
                    <li key={b.title} className="flex items-start gap-2 text-sm text-foreground">
                      <span className="mt-0.5 rounded-full bg-emerald-500/15 p-0.5 text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3 w-3" aria-hidden="true" />
                      </span>
                      <span>
                        <span className="font-medium">{b.title}</span>
                        <span className="block text-xs text-muted-foreground">{b.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Cara bayar — QRIS / transfer bank (gateway agnostic copy) */}
          <div className="mt-8 border-t border-border pt-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              Cara bayar
            </h2>
            <p className="mt-3 text-sm text-foreground">
              Bayar sekali, aktif 30 hari. Pembayaran diproses otomatis lewat{" "}
              <span className="font-semibold">QRIS atau transfer bank</span> — tanpa perlu
              kartu, tanpa ribet. Setelah pembayaran terverifikasi, paket PRO aktif langsung.
            </p>
          </div>

          <div className="mt-8 border-t border-border pt-6 text-center">
            <Button asChild size="lg" className="w-full rounded-full font-bold sm:w-auto sm:px-10">
              <Link href={ctaHref} data-testid="pricing-cta">
                Bayar sekarang
              </Link>
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Pembayaran aman via QRIS / transfer bank — tagihan bulanan berhenti otomatis
              saat dibatalkan.
            </p>
          </div>
        </div>

        {/* FAQ */}
        <section className="mt-12" aria-label="Pertanyaan umum">
          <h2 className="flex items-center justify-center gap-2 text-lg font-bold text-foreground">
            <HelpCircle className="h-5 w-5 text-primary" aria-hidden="true" />
            Pertanyaan umum
          </h2>
          <div className="mt-6 space-y-4" data-testid="pricing-faq">
            {FAQS.map((faq) => (
              <div key={faq.q} className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground">{faq.q}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
