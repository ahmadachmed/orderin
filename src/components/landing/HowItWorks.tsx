import { Banknote, ListOrdered, Store } from "lucide-react";

/**
 * 3-step row (T29, konsep landingpage2.html): Pilih dari Menu / Bayar di
 * Awal / Pantau Antrean Langsung. Mobile stack, desktop 3-col row.
 */
const STEPS = [
  {
    icon: ListOrdered,
    title: "Pilih dari Menu",
    description: "Jelajahi pilihan racikan premium dan signature favoritmu.",
  },
  {
    icon: Banknote,
    title: "Bayar di Awal",
    description: "Checkout yang aman dan cepat langsung dari perangkatmu.",
  },
  {
    icon: Store,
    title: "Pantau Antrean Langsung",
    description: "Tahu persis kapan kopimu siap diambil.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-[1200px] scroll-mt-24 border-t border-border px-6 py-12 md:px-12 md:py-16" id="how-it-works">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.title} className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-primary">
              <step.icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="mb-1 font-bold text-foreground">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
