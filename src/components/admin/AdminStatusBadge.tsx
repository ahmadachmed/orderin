// Admin-scoped status badge (T4). T3 owns the shared components/OrderStatusBadge.
import type { OrderStatus } from "@/types/admin";

// Dark-first styles per PLAN §2.1 badge table (bg-X/10 text-X border-X/20).
const STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  CONFIRMED: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  BREWING: "bg-primary/10 text-primary border-primary/20",
  READY_FOR_PICKUP: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  PICKED_UP: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-destructive/10 text-destructive border-destructive/20",
};

const LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Dikonfirmasi",
  BREWING: "Diracik",
  READY_FOR_PICKUP: "Siap Diambil",
  PICKED_UP: "Selesai",
  CANCELLED: "Dibatalkan",
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
