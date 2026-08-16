import { Button } from "@/components/ui/button";

/**
 * Final CTA (T29, konsep landingpage2.html): "Siap untuk kopimu berikutnya?"
 * + tombol Pesan Sekarang → scroll target #search-box.
 */
export function FinalCta() {
  return (
    <section className="relative overflow-hidden px-6 py-16 md:px-12 md:py-24">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[2rem] border border-border bg-card px-6 py-14 text-center md:px-12 md:py-20">
        {/* Inner glow (konsep) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[120px]"
        />
        <div className="relative z-10 mx-auto max-w-2xl space-y-6">
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground md:text-5xl">
            Siap untuk kopimu berikutnya?
          </h2>
          <p className="text-base text-muted-foreground md:text-lg">
            Bergabunglah dengan ribuan pelanggan yang melewati antrean setiap
            hari.
          </p>
          <Button
            asChild
            size="lg"
            className="h-auto rounded-full px-10 py-4 text-lg font-bold shadow-[0_0_20px_rgba(232,127,36,0.3)]"
          >
            <a href="#search-box">Pesan Sekarang</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
