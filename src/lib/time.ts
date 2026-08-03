/**
 * Operating-hours check. openTime/closeTime are stored "HH:mm" UTC
 * (PLAN §7.3 — all-UTC). Handles overnight ranges (close < open).
 */
export function isWithinHours(open: string, close: string, now: Date = new Date()): boolean {
  const hm = now.toISOString().slice(11, 16); // current HH:mm UTC
  if (open <= close) return hm >= open && hm < close;
  return hm >= open || hm < close; // wraps past midnight
}
