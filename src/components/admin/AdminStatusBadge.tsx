// Admin-scoped status badge (T4). T3 owns the shared components/OrderStatusBadge.
import type { OrderStatus } from "@/types/admin";

const STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-300",
  CONFIRMED: "bg-blue-100 text-blue-800 border-blue-300",
  BREWING: "bg-violet-100 text-violet-800 border-violet-300",
  READY_FOR_PICKUP: "bg-emerald-100 text-emerald-800 border-emerald-300",
  PICKED_UP: "bg-slate-200 text-slate-600 border-slate-300",
  CANCELLED: "bg-rose-100 text-rose-700 border-rose-300",
};

const LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  BREWING: "Brewing",
  READY_FOR_PICKUP: "Ready",
  PICKED_UP: "Picked up",
  CANCELLED: "Cancelled",
};

export default function AdminStatusBadge({
  status,
}: {
  status: OrderStatus;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
