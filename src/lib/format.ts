/** Formatting helpers for the public frontend (IDR currency, durations). */

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** 18000 -> "Rp 18.000" */
export function formatRupiah(value: number): string {
  return idr.format(value);
}

/** 150 -> "±2 menit", 45 -> "<1 menit", 3600 -> "±60 menit" */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "<1 menit";
  return `±${minutes} menit`;
}
