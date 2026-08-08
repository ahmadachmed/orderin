"use client";

import { Card } from "@/components/ui/card";
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
 *
 * P1/P2 restyle (§2.2): Card primitive — surface #1A1A1A, border #262626,
 * rounded-xl. 3 states: closed gray / empty green / active amber.
 */
export default function QueueIndicator({ queueSeconds, isOpen }: QueueIndicatorProps) {
  if (!isOpen) {
    return (
      <Card className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
        Kedai tutup — pesanan dibuka kembali sesuai jam operasional
      </Card>
    );
  }

  if (queueSeconds <= 0) {
    return (
      <Card className="flex items-center gap-2 border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Antrean kosong — pesananmu langsung diproses
      </Card>
    );
  }

  return (
    <Card className="flex items-center gap-2 border-primary/20 bg-primary/10 px-4 py-2.5 text-sm text-primary">
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      Estimasi antrean saat ini: <span className="font-semibold">{formatDuration(queueSeconds)}</span>
    </Card>
  );
}
