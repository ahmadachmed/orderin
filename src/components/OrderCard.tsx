"use client";

// OrderCard — admin dashboard order card (PLAN §8: "For the admin dashboard").
// Shows customer name, items, totals, payment status; exposes lifecycle
// actions: mark paid, advance/regress status, cancel (pending only).
// Respects the payment gate: BREWING is blocked until paymentStatus=PAID.

import { useMemo } from "react";
import type { Order, OrderStatus } from "@/types/admin";
import {
  canAdvanceToBrewing,
  formatDuration,
  formatPrice,
  isStuck,
} from "@/types/admin";
import AdminStatusBadge from "./admin/AdminStatusBadge";
import PaymentBadge from "./admin/PaymentBadge";

interface Props {
  order: Order;
  now: Date;
  onStatusChange: (orderId: string, status: OrderStatus) => void;
  onMarkPaid: (orderId: string) => void;
  onCancel: (orderId: string) => void;
  onDragStart?: (e: React.DragEvent, order: Order) => void;
  onDragEnd?: () => void;
}

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: "CONFIRMED",
  CONFIRMED: "BREWING",
  BREWING: "READY_FOR_PICKUP",
  READY_FOR_PICKUP: "PICKED_UP",
};

export default function OrderCard({
  order,
  now,
  onStatusChange,
  onMarkPaid,
  onCancel,
  onDragStart,
  onDragEnd,
}: Props) {
  const stuck = useMemo(() => isStuck(order, now), [order, now]);
  const total = useMemo(
    () =>
      (order.items ?? []).reduce(
        (sum, it) => sum + (typeof it.unitPrice === "string" ? parseFloat(it.unitPrice) : it.unitPrice) * it.quantity,
        0,
      ),
    [order.items],
  );

  const next = NEXT[order.status];
  const brewingBlocked =
    next === "BREWING" && !canAdvanceToBrewing(order.paymentStatus);
  const isTerminal =
    order.status === "PICKED_UP" || order.status === "CANCELLED";

  return (
    <div
      draggable={!isTerminal}
      onDragStart={(e) => onDragStart?.(e, order)}
      onDragEnd={onDragEnd}
      className={`rounded-lg border bg-white p-3 shadow-sm transition ${
        stuck ? "border-rose-400 ring-2 ring-rose-200" : "border-slate-200"
      } ${isTerminal ? "opacity-60" : "cursor-grab hover:shadow-md active:cursor-grabbing"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">
            {order.customerName}
          </p>
          <p className="text-xs text-slate-500">{order.customerPhone}</p>
          <p className="font-mono text-[10px] text-slate-400">
            #{order.id.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <AdminStatusBadge status={order.status} />
          <PaymentBadge paymentStatus={order.paymentStatus} />
        </div>
      </div>

      {/* Items */}
      <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
        {(order.items ?? []).map((it) => (
          <li key={it.id} className="flex justify-between gap-2">
            <span className="truncate">
              {it.quantity}× {it.name ?? "Item"}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatPrice(
                (typeof it.unitPrice === "string" ? parseFloat(it.unitPrice) : it.unitPrice) * it.quantity,
              )}
            </span>
          </li>
        ))}
        {!order.items?.length && (
          <li className="italic text-slate-400">No items</li>
        )}
      </ul>

      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
        <span className="tabular-nums">
          Total {formatPrice(total)}
          {order.etaSeconds != null && (
            <span className="ml-2 text-slate-400">
              ETA {formatDuration(order.etaSeconds)}
            </span>
          )}
        </span>
        {stuck && (
          <span className="font-semibold text-rose-600">
            Stuck {">"}10m
          </span>
        )}
      </div>

      {/* Payment gate hint */}
      {brewingBlocked && (
        <p className="mt-2 rounded bg-orange-50 px-2 py-1 text-xs text-orange-700">
          🔒 Mark payment PAID before brewing
        </p>
      )}

      {/* Customer transfer info (issue #7: surfaced on the admin card) */}
      {order.customerTransferNote && (
        <p className="mt-2 rounded bg-sky-50 px-2 py-1 text-xs text-sky-800">
          💬 {order.customerTransferNote}
        </p>
      )}
      {order.paidAt && (
        <p className="mt-1 text-xs text-emerald-700">
          ✓ Paid {new Date(order.paidAt).toLocaleString("id-ID")}
          {order.paymentMethod ? ` via ${order.paymentMethod.replaceAll("_", " ")}` : ""}
        </p>
      )}

      {/* Actions */}
      {!isTerminal && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {order.paymentStatus === "UNPAID" && (
            <button
              onClick={() => onMarkPaid(order.id)}
              className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Mark paid
            </button>
          )}
          {next && (
            <button
              onClick={() => onStatusChange(order.id, next)}
              disabled={brewingBlocked}
              title={brewingBlocked ? "Payment must be PAID first" : `Advance to ${next}`}
              className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              → {next.replaceAll("_", " ").toLowerCase()}
            </button>
          )}
          {order.status === "PENDING" && (
            <button
              onClick={() => onCancel(order.id)}
              className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
