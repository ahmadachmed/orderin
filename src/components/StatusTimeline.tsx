"use client";
import { StatusLogEntry } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pesanan dibuat",
  CONFIRMED: "Dikonfirmasi",
  BREWING: "Sedang dibuat",
  READY_FOR_PICKUP: "Siap diambil",
  PICKED_UP: "Sudah diambil",
  CANCELLED: "Dibatalkan",
};

export default function StatusTimeline({ logs }: { logs: StatusLogEntry[] }) {
  if (!logs?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {logs.map((l) => (
        <div key={l.id} className="flex gap-3 text-sm">
          <div className="flex flex-col items-center">
            <div className="h-2 w-2 rounded-full bg-neutral-400" />
            <div className="w-px flex-1 bg-neutral-200" />
          </div>
          <div className="pb-3">
            <p className="font-medium text-neutral-900">
              {STATUS_LABELS[l.status] ?? l.status}
            </p>
            <p className="text-xs text-neutral-500">
              {l.actorName ? `${l.actorName} • ` : ""}
              {new Date(l.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
