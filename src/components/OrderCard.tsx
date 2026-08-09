"use client";

// OrderCard — admin dashboard order card (PLAN §8: "For the admin dashboard").
// Shows customer name, items, totals, payment status; exposes lifecycle
// actions: mark paid, advance/regress status, cancel (pending only).
// Respects the payment gate: BREWING is blocked until paymentStatus=PAID.
// Restyle per PLAN §2.5 — className/structure only; props, handlers, and
// label texts are unchanged (E2E contract).

import { useMemo } from "react";
import type { Order, OrderStatus } from "@/types/admin";
import {
  canAdvanceToBrewing,
  formatDuration,
  formatPrice,
  isStuck,
} from "@/types/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <Card
      draggable={!isTerminal}
      onDragStart={(e) => onDragStart?.(e, order)}
      onDragEnd={onDragEnd}
      className={`p-3 transition ${
        stuck ? "border-destructive ring-2 ring-destructive/20" : ""
      } ${isTerminal ? "opacity-60" : "cursor-grab hover:shadow-md active:cursor-grabbing"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">
            {order.customerName}
          </p>
          <p className="text-xs text-muted-foreground">{order.customerPhone}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            #{order.id.slice(0, 8).toUpperCase()}
          </p>
          {order.pickupCode && order.status === "READY_FOR_PICKUP" && (
            <p className="mt-1 font-mono text-sm font-bold tabular-nums text-primary">
              PIN: {order.pickupCode}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <AdminStatusBadge status={order.status} />
          <PaymentBadge paymentStatus={order.paymentStatus} />
        </div>
      </div>

      {/* Items */}
      <ul className="mt-2 space-y-0.5 text-sm text-foreground">
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
          <li className="italic text-muted-foreground">No items</li>
        )}
      </ul>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          Total {formatPrice(total)}
          {order.etaSeconds != null && (
            <span className="ml-2 text-muted-foreground">
              ETA {formatDuration(order.etaSeconds)}
            </span>
          )}
        </span>
        {stuck && (
          <span className="font-semibold text-destructive">
            Stuck {">"}10m
          </span>
        )}
      </div>

      {/* Payment gate hint */}
      {brewingBlocked && (
        <p className="mt-2 rounded bg-primary/10 p-2 text-xs text-primary">
          🔒 Mark payment PAID before brewing
        </p>
      )}

      {/* Customer transfer info (issue #7: surfaced on the admin card) */}
      {order.customerTransferNote && (
        <p className="mt-2 rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-400">
          💬 {order.customerTransferNote}
        </p>
      )}
      {order.paidAt && (
        <p className="mt-1 text-xs text-emerald-400">
          ✓ Paid {new Date(order.paidAt).toLocaleString("id-ID")}
          {order.paymentMethod ? ` via ${order.paymentMethod.replaceAll("_", " ")}` : ""}
        </p>
      )}

      {/* Actions */}
      {!isTerminal && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {order.paymentStatus === "UNPAID" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onMarkPaid(order.id)}
            >
              Mark paid
            </Button>
          )}
          {next && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onStatusChange(order.id, next)}
              disabled={brewingBlocked}
              title={brewingBlocked ? "Payment must be PAID first" : `Advance to ${next}`}
            >
              → {next.replaceAll("_", " ").toLowerCase()}
            </Button>
          )}
          {order.status === "PENDING" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCancel(order.id)}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
