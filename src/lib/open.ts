/**
 * #207 v2 — schedule-auto + time-boxed toggle override.
 *
 * The operating-hours schedule is ALWAYS authoritative at its boundaries:
 * - at openTime each day the shop auto-OPENS (even after an admin force-close)
 * - at closeTime each day the shop auto-CLOSES (even after an admin force-open)
 *
 * Between boundaries the admin Buka/Tutup toggle is a temporary override:
 * toggling sets `isOpenOverrideUntil` to the next boundary occurrence (of
 * either openTime or closeTime). While the override is active, `isOpen`
 * wins; once it expires, the schedule takes over again.
 *
 * openTime/closeTime are stored "HH:mm" UTC (PLAN §7.3 — all-UTC). Overnight
 * ranges (close < open, e.g. 14:00–04:00) are handled by isWithinHours and by
 * nextBoundary's day-rollover logic.
 */

import { isWithinHours } from "./time";

/** Minimal shape of a Tenant row the open-state helpers need. */
export interface OpenStateTenant {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  isOpenOverrideUntil?: Date | string | null;
}

/**
 * Effective open state for a tenant at `now`.
 *
 * Override active (isOpenOverrideUntil set and still in the future) →
 * the admin's toggle value (`isOpen`) wins. Otherwise the schedule
 * (`isWithinHours`) governs — an expired override falls back to schedule.
 */
export function effectiveOpen(
  tenant: OpenStateTenant,
  now: Date = new Date(),
): boolean {
  const until = tenant.isOpenOverrideUntil
    ? new Date(tenant.isOpenOverrideUntil)
    : null;
  if (until !== null && !Number.isNaN(until.getTime()) && now < until) {
    return tenant.isOpen;
  }
  return isWithinHours(tenant.openTime, tenant.closeTime, now);
}

/** Same calendar day as `now`, at the given UTC "HH:mm". */
function atHHMM(hhmm: string, now: Date): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m),
  );
}

/**
 * Next occurrence (strictly after `now`) of either the openTime or the
 * closeTime boundary — the instant the current toggle override expires and
 * the schedule takes over. Handles overnight ranges by comparing absolute
 * Date values, so the earlier of the two candidate boundaries wins.
 *
 * Used by the toggle UI: updateSettings({ isOpen: next,
 * isOpenOverrideUntil: nextBoundary(openTime, closeTime) }).
 */
export function nextBoundary(
  open: string,
  close: string,
  now: Date = new Date(),
): Date {
  const DAY_MS = 86_400_000;
  const openToday = atHHMM(open, now);
  const closeToday = atHHMM(close, now);
  // Strictly-after semantics: a boundary exactly at `now` belongs to the past.
  const openNext = openToday.getTime() > now.getTime() ? openToday : new Date(openToday.getTime() + DAY_MS);
  const closeNext = closeToday.getTime() > now.getTime() ? closeToday : new Date(closeToday.getTime() + DAY_MS);
  return openNext < closeNext ? openNext : closeNext;
}
