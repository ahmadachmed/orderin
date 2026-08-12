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

/**
 * T25-2 — detect whether an operating-hours range crosses midnight in the
 * tenant's timezone. Converts both UTC "HH:mm" strings via
 * formatTimeInTimezone, then checks close < open post-conversion.
 * Pure function, no side effects. Invalid timezone falls back to
 * comparing the raw UTC values (close < open → overnight in UTC).
 */
export function isOvernightHours(openUtc: string, closeUtc: string, timezone: string): boolean {
  const openLocal = formatTimeInTimezone(openUtc, timezone);
  const closeLocal = formatTimeInTimezone(closeUtc, timezone);
  return closeLocal < openLocal;
}

/**
 * T25-2 — format operating hours for display. Returns local-time labels
 * (via formatTimeInTimezone) plus whether the range wraps past midnight
 * (isOvernight), so callers can append the "besok" marker. Invalid
 * timezone → raw UTC strings (callers add the "UTC" suffix).
 */
export function formatOperatingHours(
  openUtc: string,
  closeUtc: string,
  timezone: string,
): { openDisplay: string; closeDisplay: string; isOvernight: boolean } {
  return {
    openDisplay: formatTimeInTimezone(openUtc, timezone),
    closeDisplay: formatTimeInTimezone(closeUtc, timezone),
    isOvernight: isOvernightHours(openUtc, closeUtc, timezone),
  };
}
