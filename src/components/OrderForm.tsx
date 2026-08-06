"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MenuItemView, CartLine } from "@/types";
import { formatRupiah } from "@/lib/format";
import MenuList from "@/components/MenuList";

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

  const cartLines: CartLine[] = items
    .map((it) => ({ menuItemId: it.id, quantity: quantities[it.id] ?? 0 }))
    .filter((l) => l.quantity > 0);

  const total = cartLines.reduce(
    (acc, l) => acc + (items.find((i) => i.id === l.menuItemId)?.price ?? 0) * l.quantity,
    0
  );

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

  const inputCls =
    "w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none";

  return (
    <form onSubmit={handleSubmit} className="pb-28">
      <MenuList items={items} quantities={quantities} onQuantityChange={handleQuantityChange} />

      {!isOpen ? (
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {closedMessage ?? "Kedai tutup saat ini — pesanan belum bisa diterima."}
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Data kamu</h2>
            <div className="space-y-3">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nama"
                className={inputCls}
                autoComplete="name"
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Nomor HP (mis. 0812xxxx)"
                className={inputCls}
                autoComplete="tel"
              />
            </div>
          </div>

          {error ? (
            <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
          ) : null}

          {/* Sticky bottom summary bar — mobile-web-first */}
          <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
            <div className="mx-auto flex max-w-md items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-neutral-500">Total</p>
                <p className="text-lg font-bold text-neutral-900">
                  {formatRupiah(total)}
                </p>
              </div>
              <button
                type="submit"
                disabled={submitting || cartLines.length === 0}
                className="rounded-full bg-neutral-900 px-6 py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-40"
              >
                {submitting ? "Memproses..." : "Buat Pesanan"}
              </button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
