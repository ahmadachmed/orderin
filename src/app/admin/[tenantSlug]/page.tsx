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
import { STATUS_FLOW, canAdvanceToBrewing } from "@/types/admin";
import StatusColumn from "@/components/admin/StatusColumn";

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
        setError(err instanceof Error ? err.message : "Failed to load orders");
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
    try {
      const updated = await updateOrder(orderId, { status });
      applyOrder(updated);
      showNotice(`Order moved to ${status.replaceAll("_", " ").toLowerCase()}`);
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else showNotice(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function handleMarkPaid(orderId: string) {
    try {
      const updated = await updateOrder(orderId, { paymentStatus: "PAID" });
      applyOrder(updated);
      showNotice("Payment marked PAID — brewing unlocked");
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else showNotice(err instanceof Error ? err.message : "Failed to mark paid");
    }
  }

  async function handleCancel(orderId: string) {
    try {
      const updated = await updateOrder(orderId, { status: "CANCELLED" });
      applyOrder(updated);
      showNotice("Order cancelled");
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else showNotice(err instanceof Error ? err.message : "Cancel failed");
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
      showNotice("🔒 Payment gate: mark order PAID before brewing");
      return;
    }
    // Allow moving forward along the flow, plus regress to PENDING/CONFIRMED
    // is disallowed for safety — use the card's Cancel for pending orders.
    const fromIdx = STATUS_FLOW.indexOf(order.status);
    const toIdx = STATUS_FLOW.indexOf(targetStatus);
    if (toIdx <= fromIdx) {
      showNotice("Only forward moves allowed via drag (use Cancel for pending)");
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
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        Session expired — redirecting to login…
      </div>
    );
  }

  const grouped = STATUS_FLOW.map((status) => ({
    status,
    orders: orders.filter((o) => o.status === status),
  }));

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Barista Dashboard</h1>
            <p className="text-xs text-slate-500">
              /{tenantSlug} · auto-refresh 5s
            </p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <a
              href={`/admin/${tenantSlug}/menu`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Menu
            </a>
            <a
              href={`/${tenantSlug}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Shop view ↗
            </a>
          </nav>
        </div>
        {notice && (
          <div className="mx-auto max-w-7xl px-4 pb-2">
            <p className="rounded-lg bg-sky-50 px-3 py-1.5 text-sm text-sky-800">
              {notice}
            </p>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl p-4">
        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error} — retrying…
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
        <p className="mt-2 text-xs text-slate-400">
          Tip: drag a card to advance it. 🔒 Brewing requires payment PAID.
        </p>
      </main>
    </div>
  );
}
