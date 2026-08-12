"use client";

// Kanban column for the admin dashboard — one per OrderStatus.
// Acts as drop target for drag-and-drop (issue #5).

import type { Order, OrderStatus } from "@/types/admin";
import OrderCard from "../OrderCard";
import AdminStatusBadge from "./AdminStatusBadge";

interface Props {
  status: OrderStatus;
  orders: Order[];
  now: Date;
  onStatusChange: (orderId: string, status: OrderStatus) => void;
  onMarkPaid: (orderId: string) => void;
  onCancel: (orderId: string) => void;
  onDropOrder: (order: Order, targetStatus: OrderStatus) => void;
  onDragStart?: (e: React.DragEvent, order: Order) => void;
  onDragEnd?: () => void;
  isDropTarget: boolean;
}

export default function StatusColumn({
  status,
  orders,
  now,
  onStatusChange,
  onMarkPaid,
  onCancel,
  onDropOrder,
  onDragStart,
  onDragEnd,
  isDropTarget,
}: Props) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData("application/json");
        if (!raw) return;
        try {
          onDropOrder(JSON.parse(raw) as Order, status);
        } catch {
          // malformed payload — ignore
        }
      }}
      className={`flex min-h-[60vh] w-64 shrink-0 flex-col rounded-xl border bg-slate-50 p-2 transition ${
        isDropTarget ? "border-sky-400 ring-2 ring-sky-200" : "border-slate-200"
      }`}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <AdminStatusBadge status={status} />
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {orders.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {orders.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">Kosong</p>
        )}
        {orders.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            now={now}
            onStatusChange={onStatusChange}
            onMarkPaid={onMarkPaid}
            onCancel={onCancel}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  );
}
