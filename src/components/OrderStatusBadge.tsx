"use client";

import { OrderStatus } from "@/types";

const STATUS_META: Record<OrderStatus, { label: string; cls: string; dot: string }> = {
  PENDING: {
    label: "Menunggu konfirmasi",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
  },
  CONFIRMED: {
    label: "Dikonfirmasi",
    cls: "bg-sky-50 text-sky-800 border-sky-200",
    dot: "bg-sky-500",
  },
  BREWING: {
    label: "Sedang dibuat",
    cls: "bg-violet-50 text-violet-800 border-violet-200",
    dot: "bg-violet-500",
  },
  READY_FOR_PICKUP: {
    label: "Siap diambil",
    cls: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
  },
  PICKED_UP: {
    label: "Selesai",
    cls: "bg-neutral-100 text-neutral-700 border-neutral-200",
    dot: "bg-neutral-400",
  },
  CANCELLED: {
    label: "Dibatalkan",
    cls: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
  },
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${meta.cls}`}
    >
      <span className={`h-2 w-2 rounded-full ${meta.dot} ${status === "PENDING" ? "animate-pulse" : ""}`} />
      {meta.label}
    </span>
  );
}
