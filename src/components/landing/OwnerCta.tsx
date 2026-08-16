import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

const BENEFITS = [
  "Dasbor pesanan sederhana untuk barista",
  "Pembayaran QRIS, transfer, atau tunai",
  "Antrean & ETA otomatis untuk pelanggan",
];

/**
 * Owner CTA (T29, restyle ringan per konsep landingpage2.html): ajakan
 * daftar kedai + 3 benefit + tombol Daftar Gratis.
 */
export function OwnerCta() {
  return (
    <section id="tentang" className="scroll-mt-24 px-6 pb-8 md:px-12">
      <div className="mx-auto max-w-[1200px]">
        <div className="relative overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-card to-muted p-6 md:p-10">
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2 className="text-xl font-bold text-foreground md:text-2xl">
                Punya Kedai Kopi?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Daftarkan kedai Anda gratis. Terima pesanan takeaway, kurangi
                antrean, dan kelola antrean dari satu dasbor.
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {BENEFITS.map((benefit) => (
                  <li
                    key={benefit}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              asChild
              className="h-auto w-full rounded-full px-8 py-3.5 font-bold shadow-lg shadow-primary/20 md:w-auto"
            >
              <Link href="/register">Daftar Gratis</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
