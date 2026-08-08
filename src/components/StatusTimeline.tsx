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
      {logs.map((l, i) => (
        <div key={l.id} className="flex gap-3 text-sm">
          <div className="flex flex-col items-center">
            <div
              className={`w-2 h-2 rounded-full ${
                i === logs.length - 1 ? "bg-primary" : "bg-muted-foreground"
              }`}
            />
            <div className="w-px flex-1 bg-border" />
          </div>
          <div className="pb-3">
            <p className="text-foreground font-medium">
              {STATUS_LABELS[l.status] ?? l.status}
            </p>
            <p className="text-muted-foreground text-xs">
              {l.actorName ? `${l.actorName} • ` : ""}
              {new Date(l.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
