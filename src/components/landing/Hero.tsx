import { ArrowDownRight, Coffee, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import ShopSearchForm, { type ShopTenant } from "@/components/ShopSearchForm";
import ScrollToSearch from "@/components/landing/ScrollToSearch";

interface HeroProps {
  openCount: number;
  tenants: ShopTenant[];
}

export function Hero({ openCount, tenants }: HeroProps) {
  return (
    <section className="px-6 pb-14 pt-12 md:px-12 md:pb-24 md:pt-20">
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div className="space-y-7">
          <div className="inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <span className="h-2 w-2 rounded-full bg-primary ring-4 ring-primary/10" />
            {openCount} Kedai Buka Sekarang
          </div>
          <h1 className="text-5xl font-medium leading-[1.1] tracking-[-0.045em] text-foreground sm:text-6xl xl:text-7xl">
            Kopi favoritmu.
            <br />
            <span className="text-primary">Tanpa buru-buru.</span>
          </h1>
          <p className="max-w-md text-base leading-8 text-muted-foreground">
            Pesan lebih dulu dari kedai pilihanmu. Pantau prosesnya, lalu ambil
            kopimu saat sudah siap. Lebih banyak waktu untuk menikmati hari.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-auto gap-6 rounded-lg px-6 py-4 font-semibold">
              <ScrollToSearch>
                Pesan Sekarang <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
              </ScrollToSearch>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-auto rounded-lg bg-transparent px-6 py-4 font-semibold">
              <a href="#shop-search">Lacak Pesanan</a>
            </Button>
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            Cari kedai lalu gunakan tombol Lacak di halaman kedai.
          </p>
          <div className="flex flex-wrap gap-5 border-t border-border pt-6 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2"><Coffee className="h-4 w-4" aria-hidden="true" /> Pesan dari browser</span>
            <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" aria-hidden="true" /> Ambil di kedai</span>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg shadow-primary/5">
          <div className="flex items-center justify-between gap-4 bg-primary px-6 py-6 text-primary-foreground md:px-8">
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-primary-foreground/75">Mulai dari sini</p>
              <h2 className="text-xl font-medium tracking-tight">Mau ngopi di mana?</h2>
            </div>
            <Coffee className="h-8 w-8 shrink-0 text-accent" aria-hidden="true" />
          </div>
          <div id="search-box" className="scroll-mt-28 p-5 md:p-8">
            <ShopSearchForm tenants={tenants} />
          </div>
        </div>
      </div>
    </section>
  );
}
