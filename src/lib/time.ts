/**
 * Operating-hours check. openTime/closeTime are stored "HH:mm" UTC
 * (PLAN §7.3 — all-UTC). Handles overnight ranges (close < open).
 */
export function isWithinHours(open: string, close: string, now: Date = new Date()): boolean {
  const hm = now.toISOString().slice(11, 16); // current HH:mm UTC
  if (open <= close) return hm >= open && hm < close;
  return hm >= open || hm < close; // wraps past midnight
}

const HH_MM = /^(\d{2}):(\d{2})$/;

/**
 * SETTINGS-05 — convert a UTC "HH:mm" string to the tenant's timezone for
 * display. Graceful fallbacks: malformed input → raw string; invalid
 * timezone → raw UTC string (try/catch — Intl throws RangeError).
 */
export function formatTimeInTimezone(utcHHmm: string, timezone: string): string {
  const m = HH_MM.exec(utcHHmm ?? "");
  if (!m) return utcHHmm;
  const utc = Date.UTC(2024, 0, 1, Number(m[1]), Number(m[2]));
  let local: string;
  try {
    local = new Date(utc).toLocaleTimeString("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return utcHHmm; // invalid timezone → raw UTC
  }
  // Normalize the "24:00" midnight quirk some engines emit for 00:xx.
  return local === "24:00" ? "00:00" : local;
}
