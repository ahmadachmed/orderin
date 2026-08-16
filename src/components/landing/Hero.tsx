import { Button } from "@/components/ui/button";
import ShopSearchForm, { type ShopTenant } from "@/components/ShopSearchForm";

interface HeroProps {
  openCount: number;
  tenants: ShopTenant[];
}

/**
 * Hero (T29, konsep landingpage2.html). Left column: live counter badge,
 * headline, sub, 2 CTA (Pesan Sekarang → #search-box glow target, Lacak
 * Pesanan → #shop-search — contract e2e/lookup.spec.ts:128-137). Right
 * column: search card wrapping ShopSearchForm (D6). The input inside
 * ShopSearchForm keeps the single `id="shop-search"` (contract F4 — the
 * scroll anchor resolves to it; no duplicate section id, happy-path fill
 * stays strict-mode safe).
 */
export function Hero({ openCount, tenants }: HeroProps) {
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-10 md:px-12 md:pb-24 md:pt-20">
      {/* Decorative blur (konsep) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-0 h-96 w-96 rounded-full bg-primary/10 blur-[100px]"
      />

      <div className="relative mx-auto grid w-full max-w-[1200px] items-center gap-12 md:grid-cols-2">
        {/* Left: copy + CTAs */}
        <div className="space-y-6 md:space-y-8">
          {/* Live counter badge — real openCount (jangan hardcode 12) */}
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-muted px-3 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wide text-primary">
              {openCount} Kedai Buka Sekarang
            </span>
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-foreground md:text-6xl">
            Lewati Antrean.
            <br />
            <span className="text-primary">Pesan Kopi</span>
            <br />
            dalam Hitungan Detik.
          </h1>

          <p className="max-w-md text-base font-medium leading-relaxed text-muted-foreground md:text-lg">
            Cara tercepat untuk mendapatkan kopi harianmu. Cek posisi antrean
            real-time dan ETA yang akurat sebelum kamu tiba.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-auto rounded-full px-8 py-3.5 font-bold shadow-lg shadow-primary/20"
            >
              <a href="#search-box">Pesan Sekarang</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-auto rounded-full px-8 py-3.5 font-bold"
            >
              <a href="#shop-search">Lacak Pesanan</a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Cari kedai lalu gunakan tombol Lacak di halaman kedai.
          </p>
        </div>

        {/* Right: search card (konsep hero card) — ShopSearchForm dipindah ke
            sini (D6): div#search-box = glow target, DI DALAM hero card. */}
        <div className="relative rounded-2xl border border-border bg-card/50 p-6 backdrop-blur-sm md:p-8">
          <div id="search-box" className="scroll-mt-24">
            <ShopSearchForm tenants={tenants} />
          </div>
        </div>
      </div>
    </section>
  );
}
