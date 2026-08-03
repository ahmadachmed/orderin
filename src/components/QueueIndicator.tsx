"use client";

import { formatDuration } from "@/lib/format";

interface QueueIndicatorProps {
  /** Estimated queue time in seconds for a NEW order at this shop. */
  queueSeconds: number;
  isOpen: boolean;
}

/**
 * QueueIndicator — queue estimate on the menu page (PLAN §4 / issue #4).
 * Server computes the FIFO estimate (sum of prep time for active orders);
 * this component renders it.
 */
export default function QueueIndicator({ queueSeconds, isOpen }: QueueIndicatorProps) {
  if (!isOpen) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-600">
        <span className="h-2 w-2 rounded-full bg-neutral-400" />
        Kedai tutup — pesanan dibuka kembali sesuai jam operasional
      </div>
    );
  }

  if (queueSeconds <= 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Antrean kosong — pesananmu langsung diproses
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
      Estimasi antrean saat ini: <span className="font-semibold">{formatDuration(queueSeconds)}</span>
    </div>
  );
}
