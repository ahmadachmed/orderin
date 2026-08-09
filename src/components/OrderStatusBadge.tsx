"use client";

import { OrderStatus } from "@/types";
import { Badge } from "@/components/ui/badge";

const STATUS_META: Record<OrderStatus, { label: string; cls: string; dot: string }> = {
  PENDING: {
    label: "Menunggu konfirmasi",
    cls: "bg-warning/10 text-warning border-warning/20",
    dot: "bg-warning",
  },
  CONFIRMED: {
    label: "Dikonfirmasi",
    cls: "bg-info/10 text-info border-info/20",
    dot: "bg-info",
  },
  BREWING: {
    label: "Sedang dibuat",
    cls: "bg-primary/10 text-primary border-primary/20",
    dot: "bg-primary animate-pulse",
  },
  READY_FOR_PICKUP: {
    label: "Siap diambil",
    cls: "bg-success/10 text-success border-success/20",
    dot: "bg-success",
  },
  PICKED_UP: {
    label: "Selesai",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  CANCELLED: {
    label: "Dibatalkan",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
    dot: "bg-destructive",
  },
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.PENDING;
  return (
    <Badge className={`gap-2 ${meta.cls}`}>
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </Badge>
  );
}
