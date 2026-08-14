"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { OrderStatusView, PaymentMethod } from "@/types";
import { formatRupiah, formatDuration } from "@/lib/format";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import StatusTimeline from "@/components/StatusTimeline";
import CreateAccountBanner from "@/components/CreateAccountBanner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
  // Issue #210: local claim state — set once PATCH succeeds, independent of
  // customerTransferNote content (empty notes still get the confirmation).
  const [claimed, setClaimed] = useState(false);

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
          // Issue #210: always send the key (empty string allowed) so the
          // server can distinguish an "I have paid" claim from a plain
          // method selection and audit every claim.
          customerTransferNote: note.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Gagal menandai sudah bayar");
      setOrder((prev) => ({ ...prev, ...data, paymentMethod: "bank_transfer" }));
      setClaimed(true);
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
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Status pesanan</p>
            <div className="mt-1">
              <OrderStatusBadge status={order.status} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">No. Pesanan</p>
            <p className="text-primary font-bold tabular-nums tracking-wider">
              #{order.orderId.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>

        {order.pickupCode && order.status === "READY_FOR_PICKUP" && (
          <div className="mt-4 rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-xs text-muted-foreground">Kode pengambilan</p>
            <div className="mt-3 flex justify-center gap-2">
              {order.pickupCode.split("").map((digit, i) => (
                <span
                  key={i}
                  className="flex h-14 w-12 items-center justify-center rounded-lg border border-[#262626] bg-[#1F2020] text-2xl font-bold tabular-nums text-foreground"
                >
                  {digit}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Tunjukkan kode ini ke barista</p>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <StatusTimeline logs={order.statusLogs ?? []} />
        </div>

        {/* T19 / issue #147: 1-based FIFO queue position — in-queue statuses
            (PENDING/CONFIRMED/BREWING) only; API returns null otherwise. */}
        {order.queuePosition != null && !TERMINAL_STATUSES.has(order.status) ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Posisi antrean</p>
            <p className="font-bold text-foreground">
              Antrean ke-{order.queuePosition}
            </p>
          </div>
        ) : null}

        {order.etaSeconds != null &&
        !TERMINAL_STATUSES.has(order.status) &&
        order.status !== "READY_FOR_PICKUP" ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Estimasi siap:{" "}
              <span className="font-bold text-foreground">
                {formatDuration(order.etaSeconds)}
              </span>{" "}
              dari sekarang
            </p>
            <p className="text-xs text-muted-foreground">
              Perkiraan berdasarkan antrean — bisa lebih cepat atau lebih lambat.
            </p>
          </div>
        ) : null}
      </Card>

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
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Pesananmu</h2>
        <ul className="divide-y divide-border">
          {order.items.map((it, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 py-2 text-sm">
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{it.quantity}×</span> {it.name}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatRupiah(it.unitPrice * it.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold text-foreground">Total</span>
          <span className="text-lg font-bold text-foreground">{formatRupiah(order.total)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Atas nama: {order.customerName}</p>
      </Card>

      {/* Payment */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground">Pembayaran</h2>

        {paid ? (
          <div className="mt-3 rounded-xl bg-success/10 px-4 py-3 text-sm font-medium text-success">
            ✓ Pembayaran diterima — terima kasih!
          </div>
        ) : order.status === "CANCELLED" ? (
          <p className="mt-3 text-sm text-muted-foreground">Pesanan dibatalkan — tidak perlu membayar.</p>
        ) : (
          <>
            {!hasQris && !hasBank ? (
              <p className="mt-3 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
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
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-foreground hover:bg-accent"
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
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-foreground hover:bg-accent"
                      }`}
                    >
                      Transfer Bank
                    </button>
                  ) : null}
                </div>

                {order.paymentMethod === "qris" && (
                  <div className="mt-3 rounded-xl bg-muted p-4 text-sm text-foreground">
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
                    <p className="mt-2 text-xs text-muted-foreground">
                      Scan QRIS senilai <b>{formatRupiah(order.total)}</b> — kasir akan
                      mengonfirmasi setelah pembayaran masuk.
                    </p>
                  </div>
                )}

                {order.paymentMethod === "bank_transfer" && (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl bg-muted p-4 text-sm text-foreground">
                      <p className="font-semibold text-foreground">{t?.bankName}</p>
                      <p className="font-mono text-base font-bold tracking-wide">
                        {t?.bankAccountNumber}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Transfer <b>{formatRupiah(order.total)}</b> ke rekening di atas, lalu
                        konfirmasi di bawah.
                      </p>
                    </div>

                    {claimed || order.customerTransferNote || order.paymentStatus === "UNPAID" ? (
                      <div className="rounded-xl border border-border p-3">
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Catatan transfer (opsional) — mis. nama pengirim"
                          rows={2}
                          disabled={claimed}
                          className="w-full resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none disabled:opacity-50"
                        />
                        {claimed ? (
                          <p className="mt-2 text-xs text-success">
                            ✓ Konfirmasi terkirim — kasir akan memverifikasi pembayaranmu.
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={markPaid}
                            disabled={markingPaid}
                            className="mt-2 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-95 disabled:opacity-50"
                          >
                            {markingPaid ? "Mengirim..." : "Saya sudah bayar"}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {error ? (
          <p className="mt-3 rounded-xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>
        ) : null}
      </Card>

      <Button
        asChild
        className="w-full rounded-lg border border-border bg-[#1F2020] py-3 font-semibold text-primary hover:bg-secondary"
      >
        <Link href={`/${order.tenant.slug}/account/orders`}>Lihat riwayat pesananmu</Link>
      </Button>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Halaman ini diperbarui otomatis setiap 5 detik.
      </p>
    </div>
  );
}
