"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { User, Phone } from "lucide-react";
import { MenuItemView, CartLine } from "@/types";
import { formatRupiah } from "@/lib/format";
import MenuList from "@/components/MenuList";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface OrderFormProps {
  tenantSlug: string;
  items: MenuItemView[];
  isOpen: boolean;
  closedMessage?: string;
}

/**
 * OrderForm — customer order flow (PLAN §3.2 / issue #4).
 * Pick quantities, enter name + phone, submit -> POST /api/order (T2),
 * then redirect to the order status page.
 */
export default function OrderForm({ tenantSlug, items, isOpen, closedMessage }: OrderFormProps) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // T14-followup: category tabs — selected category filters the menu
  // client-side; null = "Semua" (all items).
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // T17-6: customer session probe — auto-attach customerId when logged in.
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  // On mount, check for a customer session cookie via a lightweight API call.
  useEffect(() => {
    fetch("/api/customer/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.loggedIn) setCustomerId(d.customerId);
      })
      .catch(() => {})
      .finally(() => setSessionChecked(true));
  }, []);

  const cartLines: CartLine[] = items
    .map((it) => ({ menuItemId: it.id, quantity: quantities[it.id] ?? 0 }))
    .filter((l) => l.quantity > 0);

  const total = cartLines.reduce(
    (acc, l) => acc + (items.find((i) => i.id === l.menuItemId)?.price ?? 0) * l.quantity,
    0
  );

  // T14-followup: derive tab list from the menu itself — unique categories
  // in first-appearance order, so tabs stay in sync with the data (items
  // without a category show under "Semua" only).
  const categories = Array.from(
    new Set(items.map((it) => it.category).filter((c): c is string => Boolean(c)))
  );
  const visibleItems =
    selectedCategory === null
      ? items
      : items.filter((it) => it.category === selectedCategory);

  const handleQuantityChange = (menuItemId: string, quantity: number) => {
    setQuantities((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[menuItemId];
      else next[menuItemId] = quantity;
      return next;
    });
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cartLines.length === 0) {
      setError("Pilih minimal satu menu dulu.");
      return;
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      setError("Nama dan nomor HP wajib diisi.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: tenantSlug,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          items: cartLines,
          customerId: customerId ?? undefined, // T17-6: auto-attach when logged in
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Gagal membuat pesanan. Coba lagi.");
        return;
      }
      const orderId = data?.orderId ?? data?.order?.id;
      if (!orderId) {
        setError("Respon server tidak valid.");
        return;
      }
      router.push(`/${tenantSlug}/order/${orderId}`);
      // CUST-02 (T16-7): persist active order so the menu page can show a
      // "Lanjutkan pesanan" banner after tab close / revisit (issue #52).
      if (typeof window !== "undefined") {
        try {
          const active = JSON.parse(localStorage.getItem("orderin_orders") ?? "{}");
          active[orderId] = {
            orderId,
            slug: tenantSlug,
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
            createdAt: Date.now(),
          };
          localStorage.setItem("orderin_orders", JSON.stringify(active));
        } catch {
          /* localStorage disabled — no-op */
        }
      }
    } catch {
      setError("Gagal terhubung ke server. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="pb-36">
      {/* Category tabs (PLAN §3.2 / T14-followup): sticky pill bar under the
          top bar, active tab uses primary. Derived from the menu data, so
          shops without categories just render "Semua" alone. */}
      {categories.length > 0 ? (
        <nav
          aria-label="Kategori menu"
          className="sticky top-14 z-30 -mx-4 bg-background px-4 pb-2 pt-3"
        >
          <ul className="flex gap-2 overflow-x-auto pb-1">
            <li>
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                aria-pressed={selectedCategory === null}
                className={
                  selectedCategory === null
                    ? "whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                    : "whitespace-nowrap rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
                }
              >
                Semua
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat}>
                <button
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  aria-pressed={selectedCategory === cat}
                  className={
                    selectedCategory === cat
                      ? "whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                      : "whitespace-nowrap rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
                  }
                >
                  {cat}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <MenuList items={visibleItems} quantities={quantities} onQuantityChange={handleQuantityChange} />

      {!isOpen ? (
        <div className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {closedMessage ?? "Kedai tutup saat ini — pesanan belum bisa diterima."}
        </div>
      ) : (
        <>
          <Card className="mt-6 border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Data kamu</h2>
            <div className="space-y-3">
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nama"
                  className="h-11 rounded-xl bg-background pl-9"
                  autoComplete="name"
                />
              </div>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Nomor HP (mis. 0812xxxx)"
                  className="h-11 rounded-xl bg-background pl-9"
                  autoComplete="tel"
                />
              </div>
            </div>
            {sessionChecked && !customerId ? (
              <p className="mt-3 text-xs text-muted-foreground">
                <Link
                  href={`/${tenantSlug}/account/orders`}
                  className="font-medium text-muted-foreground underline underline-offset-2"
                >
                  Simpan pesanan ke akun?
                </Link>
              </p>
            ) : null}
          </Card>

          {error ? (
            <p className="mt-3 rounded-xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>
          ) : null}

          {/* Sticky bottom summary bar — matches Stitch menu.html bottom cart bar */}
          <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur-lg">
            <div className="mx-auto max-w-md px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    Total Pesanan
                  </span>
                  <span className="text-lg font-bold tabular-nums text-primary">
                    {formatRupiah(total)}
                  </span>
                </div>
              </div>
              <Button
                type="submit"
                disabled={submitting || cartLines.length === 0}
                className="mt-3 h-auto w-full rounded-xl py-3.5 font-bold shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Memproses..." : "Buat Pesanan"}
              </Button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
