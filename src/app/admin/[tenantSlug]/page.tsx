"use client";

// Admin dashboard (issue #5). One screen for the full order lifecycle:
//   - Kanban columns PENDING→CONFIRMED→BREWING→READY_FOR_PICKUP→PICKED_UP
//   - Drag-and-drop between columns
//   - Payment gate: BREWING blocked until paymentStatus=PAID
//   - Order cards: customer name, items, payment status
//   - Auto-reminder: cards stuck in a status > STUCK_MINUTES are highlighted
//   - 5s polling (PLAN §6.1)

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchOrders, updateOrder } from "@/lib/admin-api";
import type { Order, OrderStatus } from "@/types/admin";
import { STATUS_FLOW, STATUS_LABELS, canAdvanceToBrewing } from "@/types/admin";
import StatusColumn from "@/components/admin/StatusColumn";
import UpsellBanner from "@/components/admin/UpsellBanner";

export default function AdminDashboardPage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params.tenantSlug;

  const [orders, setOrders] = useState<Order[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [dropTarget, setDropTarget] = useState<OrderStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // T16-6 PICKUP-01: PIN input modal for READY_FOR_PICKUP → PICKED_UP.
  const [pickupPrompt, setPickupPrompt] = useState<{ orderId: string } | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [submittingPin, setSubmittingPin] = useState(false);
  const draggedOrder = useRef<Order | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await fetchOrders();
      setOrders(data);
      setAuthError(false);
      setError(null);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) {
        setAuthError(true);
      } else {
        setError(err instanceof Error ? err.message : "Gagal memuat pesanan");
      }
    }
  }, []);

  // Initial load + 5s polling (PLAN §6.1 live order status).
  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    const clock = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      clearInterval(iv);
      clearInterval(clock);
    };
  }, [load]);

  // If the session expired, bounce to login.
  useEffect(() => {
    if (authError && tenantSlug) router.push(`/admin/${tenantSlug}/login`);
  }, [authError, tenantSlug, router]);

  function applyOrder(updated: Order) {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }

  async function handleStatusChange(orderId: string, status: OrderStatus) {
    // T16-6 PICKUP-01: READY_FOR_PICKUP → PICKED_UP needs the customer's PIN
    // (server verifies; 403 on mismatch). Capture it in a modal first.
    if (status === "PICKED_UP") {
      setPinInput("");
      setPinError(null);
      setPickupPrompt({ orderId });
      return;
    }
    try {
      const updated = await updateOrder(orderId, { status });
      applyOrder(updated);
      showNotice(`Pesanan dipindah ke ${STATUS_LABELS[status].toLowerCase()}`);
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else showNotice(err instanceof Error ? err.message : "Gagal memperbarui");
    }
  }

  async function confirmPickup() {
    if (!pickupPrompt) return;
    const order = orders.find((o) => o.id === pickupPrompt.orderId);
    // Legacy orders (pickupCode "") skip the gate server-side — PIN optional.
    const requiresPin = Boolean(order?.pickupCode);
    const pin = pinInput.trim();
    if (requiresPin && !/^\d{4}$/.test(pin)) {
      setPinError("Masukkan PIN 4 digit");
      return;
    }
    setSubmittingPin(true);
    try {
      const updated = await updateOrder(pickupPrompt.orderId, {
        status: "PICKED_UP",
        pickupCode: pin,
      });
      applyOrder(updated);
      setPickupPrompt(null);
      showNotice("Pesanan ditandai selesai");
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setPinError(err instanceof Error ? err.message : "Verifikasi PIN gagal");
    } finally {
      setSubmittingPin(false);
    }
  }

  async function handleMarkPaid(orderId: string) {
    try {
      const updated = await updateOrder(orderId, { paymentStatus: "PAID" });
      applyOrder(updated);
      showNotice("Pembayaran ditandai LUNAS — peracikan terbuka");
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else showNotice(err instanceof Error ? err.message : "Gagal menandai lunas");
    }
  }

  async function handleCancel(orderId: string) {
    try {
      const updated = await updateOrder(orderId, { status: "CANCELLED" });
      applyOrder(updated);
      showNotice("Pesanan dibatalkan");
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else showNotice(err instanceof Error ? err.message : "Gagal membatalkan");
    }
  }

  // Drag-and-drop (issue #5). Payment gate enforced on drop too:
  // dropping an UNPAID order onto BREWING (or beyond) is rejected.
  function handleDropOrder(order: Order, targetStatus: OrderStatus) {
    setDropTarget(null);
    if (order.status === targetStatus) return;
    if (
      targetStatus === "BREWING" &&
      !canAdvanceToBrewing(order.paymentStatus)
    ) {
      showNotice("🔒 Gerbang pembayaran: tandai LUNAS sebelum meracik");
      return;
    }
    // Allow moving forward along the flow, plus regress to PENDING/CONFIRMED
    // is disallowed for safety — use the card's Cancel for pending orders.
    const fromIdx = STATUS_FLOW.indexOf(order.status);
    const toIdx = STATUS_FLOW.indexOf(targetStatus);
    if (toIdx <= fromIdx) {
      showNotice("Hanya maju yang diizinkan via drag (gunakan Batal untuk pending)");
      return;
    }
    void handleStatusChange(order.id, targetStatus);
  }

  function handleDragStart(e: React.DragEvent, order: Order) {
    draggedOrder.current = order;
    e.dataTransfer.setData("application/json", JSON.stringify(order));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd() {
    draggedOrder.current = null;
    setDropTarget(null);
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted text-sm text-muted-foreground">
        Sesi berakhir — mengalihkan ke login…
      </div>
    );
  }

  const grouped = STATUS_FLOW.map((status) => ({
    status,
    orders: orders.filter((o) => o.status === status),
  }));

  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">
              Antrean Pesanan
            </h1>
            <p className="text-xs text-muted-foreground">
              Kelola pesanan masuk dan status operasional barista.
            </p>
            <p className="text-[10px] text-muted-foreground">Auto-refresh 5 detik</p>
          </div>
        </div>
        {notice && (
          <div className="mx-auto max-w-7xl px-4 pb-2">
            <p className="rounded-lg bg-sky-500/10 px-3 py-1.5 text-sm text-sky-400">
              {notice}
            </p>
          </div>
        )}
      </header>

      <UpsellBanner />

      <main className="mx-auto max-w-7xl p-4">
        {error && (
          <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
            {error} — mencoba lagi…
          </p>
        )}
        <div className="flex gap-3 overflow-x-auto pb-4">
          {grouped.map(({ status, orders: colOrders }) => (
            <StatusColumn
              key={status}
              status={status}
              orders={colOrders}
              now={now}
              onStatusChange={handleStatusChange}
              onMarkPaid={handleMarkPaid}
              onCancel={handleCancel}
              onDropOrder={handleDropOrder}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              isDropTarget={dropTarget === status}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Seret kartu untuk majukan status. Meracik (Brewing) membutuhkan
          pembayaran LUNAS.
        </p>
      </main>

      {pickupPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl">
            <h2 className="text-base font-bold text-foreground">
              Verifikasi PIN pengambilan
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Masukkan PIN 4 digit pelanggan untuk menandai pesanan selesai.
            </p>
            <input
              autoFocus
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4));
                setPinError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmPickup();
              }}
              inputMode="numeric"
              placeholder="••••"
              className="mt-4 w-full rounded-lg border border-border px-3 py-2 text-center font-mono text-2xl tracking-[0.5em] text-foreground focus:border-ring focus:outline-none"
            />
            {pinError && (
              <p className="mt-2 text-sm text-rose-400">{pinError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickupPrompt(null)}
                disabled={submittingPin}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void confirmPickup()}
                disabled={submittingPin}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {submittingPin ? "Memverifikasi…" : "Konfirmasi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
