import { ListOrdered, Smartphone, Store } from "lucide-react";

/**
 * Pesan Lebih Cerdas — feature grid 3 kartu (T29, konsep landingpage2.html).
 */
const FEATURES = [
  {
    icon: ListOrdered,
    title: "Posisi Antrean Live",
    description:
      "Tidak perlu menebak. Lihat berapa banyak pesanan di depanmu secara real-time, supaya kamu tiba di waktu yang pas.",
  },
  {
    icon: Smartphone,
    title: "Pemesanan Mobile-First",
    description:
      "Pengalaman seperti aplikasi langsung di browser. Cepat, responsif, dan dirancang untuk tap cepat saat di perjalanan.",
  },
  {
    icon: Store,
    title: "Status Buka Real-Time",
    description:
      "Langsung tahu apakah kedai menerima pesanan. Sinkron dengan dashboard barista untuk akurasi.",
  },
];

export function Features() {
  return (
    <section className="px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-12 text-center md:mb-16">
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Pesan Lebih Cerdas
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Platform pemesanan kopi yang menghubungkanmu dengan kedai favorit.
            Posisi antrean, ETA, dan status buka langsung dari ponselmu.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="flex flex-col items-start rounded-3xl border border-border bg-card p-8 transition-colors hover:border-primary/30"
            >
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-primary">
                <feature.icon className="h-6 w-6" />
              </div>
              <h3 className="mb-3 text-xl font-bold text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
