"use client";

import { useEffect, useState } from "react";
import { OrderStatusView, PaymentMethod } from "@/types";
import { formatRupiah, formatDuration } from "@/lib/format";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import StatusTimeline from "@/components/StatusTimeline";
import CreateAccountBanner from "@/components/CreateAccountBanner";

interface OrderStatusTrackerProps {
  initial: OrderStatusView;
}

const TERMINAL_STATUSES = new Set(["PICKED_UP", "CANCELLED"]);
const POLL_INTERVAL_MS = 5000;

/**
 * OrderStatusTracker — live order status page (PLAN §3.2 / issue #4).
 * Polls GET /api/order/[orderId] (T2) every 5s, shows ETA, payment details
 * (QRIS / bank transfer + total), and the "I have paid" button for transfers.
 */
export default function OrderStatusTracker({ initial }: OrderStatusTrackerProps) {
  const [order, setOrder] = useState<OrderStatusView>(initial);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [markingPaid, setMarkingPaid] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/order/${order.orderId}`, { cache: "no-store" });
        if (!res.ok) return; // keep last known state on transient errors
        const data = await res.json();
        if (!cancelled && data?.orderId) {
          setOrder((prev) => ({ ...prev, ...data }));
          if (TERMINAL_STATUSES.has(data.status)) {
            clearInterval(timer);
          }
        }
      } catch {
        // network hiccup — next tick retries
      }
    };

    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.orderId]);

  const selectMethod = async (method: PaymentMethod) => {
    setError(null);
    try {
      const res = await fetch(`/api/order/${order.orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: method }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Gagal memilih metode pembayaran");
      setOrder((prev) => ({ ...prev, paymentMethod: method }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    }
  };

  const markPaid = async () => {
    setMarkingPaid(true);
    setError(null);
    try {
      const res = await fetch(`/api/order/${order.orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: "bank_transfer",
          customerTransferNote: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Gagal menandai sudah bayar");
      setOrder((prev) => ({ ...prev, ...data, paymentMethod: "bank_transfer" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setMarkingPaid(false);
    }
  };

  const t = order.tenant;
  const hasQris = Boolean(t?.qrisCode || t?.qrisImageUrl);
  const hasBank = Boolean(t?.bankAccountNumber && t?.bankName);
  const paid = order.paymentStatus === "PAID";

  return (
    <div className="space-y-4">
      {/* Status */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Status pesanan</p>
            <div className="mt-1">
              <OrderStatusBadge status={order.status} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">No. Pesanan</p>
            <p className="font-mono text-sm font-semibold text-neutral-900">
              #{order.orderId.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>

        {order.pickupCode && order.status === "READY_FOR_PICKUP" && (
          <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-center">
            <p className="text-xs text-amber-700">Kode pengambilan</p>
            <p className="text-3xl font-bold tracking-[0.5em] text-amber-900">
              {order.pickupCode}
            </p>
            <p className="mt-1 text-xs text-amber-600">Tunjukkan kode ini ke barista</p>
          </div>
        )}

        <StatusTimeline logs={order.statusLogs ?? []} />

        {order.etaSeconds != null && !TERMINAL_STATUSES.has(order.status) ? (
          <div className="mt-3 rounded-xl bg-neutral-50 px-4 py-3">
            <p className="text-sm text-neutral-600">
              Estimasi siap:{" "}
              <span className="font-bold text-neutral-900">
                {formatDuration(order.etaSeconds)}
              </span>{" "}
              dari sekarang
            </p>
            <p className="mt-0.5 text-xs text-neutral-400">
              Perkiraan berdasarkan antrean — bisa lebih cepat atau lebih lambat.
            </p>
          </div>
        ) : null}
      </section>

      {/* T17-7: "Buat akun" banner — guest (customerPhone present) + active order */}
      {order.customerPhone && !TERMINAL_STATUSES.has(order.status) ? (
        <CreateAccountBanner
          tenantSlug={order.tenant.slug}
          customerName={order.customerName}
          customerPhone={order.customerPhone}
          orderId={order.orderId}
        />
      ) : null}

      {/* Items + total */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Pesananmu</h2>
        <ul className="divide-y divide-neutral-100">
          {order.items.map((it, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 py-2 text-sm">
              <span className="text-neutral-700">
                <span className="font-semibold text-neutral-900">{it.quantity}×</span> {it.name}
              </span>
              <span className="tabular-nums text-neutral-600">
                {formatRupiah(it.unitPrice * it.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between border-t border-neutral-200 pt-3">
          <span className="text-sm font-semibold text-neutral-900">Total</span>
          <span className="text-lg font-bold text-neutral-900">{formatRupiah(order.total)}</span>
        </div>
        <p className="mt-1 text-xs text-neutral-400">Atas nama: {order.customerName}</p>
      </section>

      {/* Payment */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Pembayaran</h2>

        {paid ? (
          <div className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            ✓ Pembayaran diterima — terima kasih!
          </div>
        ) : order.status === "CANCELLED" ? (
          <p className="mt-3 text-sm text-neutral-500">Pesanan dibatalkan — tidak perlu membayar.</p>
        ) : (
          <>
            {!hasQris && !hasBank ? (
              <p className="mt-3 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
                Pembayaran akan diarahkan oleh kasir saat pengambilan.
              </p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {hasQris ? (
                    <button
                      type="button"
                      onClick={() => selectMethod("qris")}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                        order.paymentMethod === "qris"
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 text-neutral-700 active:bg-neutral-50"
                      }`}
                    >
                      QRIS
                    </button>
                  ) : null}
                  {hasBank ? (
                    <button
                      type="button"
                      onClick={() => selectMethod("bank_transfer")}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                        order.paymentMethod === "bank_transfer"
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 text-neutral-700 active:bg-neutral-50"
                      }`}
                    >
                      Transfer Bank
                    </button>
                  ) : null}
                </div>

                {order.paymentMethod === "qris" && (
                  <div className="mt-3 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                    {t?.qrisImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.qrisImageUrl}
                        alt="QRIS"
                        className="mx-auto mb-2 h-40 w-40 rounded-lg object-contain"
                      />
                    ) : (
                      <p className="font-mono text-xs break-all">{t?.qrisCode}</p>
                    )}
                    <p className="mt-2 text-xs text-neutral-500">
                      Scan QRIS senilai <b>{formatRupiah(order.total)}</b> — kasir akan
                      mengonfirmasi setelah pembayaran masuk.
                    </p>
                  </div>
                )}

                {order.paymentMethod === "bank_transfer" && (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                      <p className="font-semibold text-neutral-900">{t?.bankName}</p>
                      <p className="font-mono text-base font-bold tracking-wide">
                        {t?.bankAccountNumber}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        Transfer <b>{formatRupiah(order.total)}</b> ke rekening di atas, lalu
                        konfirmasi di bawah.
                      </p>
                    </div>

                    {order.customerTransferNote || order.paymentStatus === "UNPAID" ? (
                      <div className="rounded-xl border border-neutral-200 p-3">
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Catatan transfer (opsional) — mis. nama pengirim"
                          rows={2}
                          className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={markPaid}
                          disabled={markingPaid}
                          className="mt-2 w-full rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
                        >
                          {markingPaid ? "Mengirim..." : "Saya sudah bayar"}
                        </button>
                        {order.customerTransferNote ? (
                          <p className="mt-2 text-xs text-emerald-700">
                            ✓ Konfirmasi terkirim — kasir akan memverifikasi pembayaranmu.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {error ? (
          <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
        ) : null}
      </section>

      <p className="pb-4 text-center text-xs text-neutral-400">
        Halaman ini diperbarui otomatis setiap 5 detik.
      </p>
    </div>
  );
}
