/**
 * Monetisation Phase 3 / T14 — billing constants + pure helpers (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §4–§7.
 *
 * Pure module: no env access, no node imports — safe to import from client
 * components (BillingCard, pricing page), route handlers, cron, and tests.
 */

/** PRO subscription price, IDR per 30-day period. */
export const PRO_PRICE_IDR = 99000;
/** Length of one paid PRO period in days. */
export const BILLING_PERIOD_DAYS = 30;
/**
 * Grace period: PRO stays active until planExpiresAt + 3 days, then the
 * cron downgrades to FREE. `invoice_duration` at Xendit (72h) matches this.
 */
export const BILLING_GRACE_DAYS = 3;
/** Re-bill window: cron opens a new invoice when the period ends within 24h. */
export const REBILL_WINDOW_HOURS = 24;
/** Xendit invoice_duration (hours) — pay window == grace period. */
export const XENDIT_INVOICE_DURATION_HOURS = 72;

/** Add N days to a Date (UTC-safe). */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Period start for a fresh upgrade (FREE tenant, or PRO in grace paying a
 * new period): the moment the payment is made.
 */
export function firstPeriodStart(now: Date): Date {
  return new Date(now.getTime());
}

/**
 * Period start for a PRO tenant's next billing cycle: the current period's
 * expiry. Deterministic per period → externalId is stable → cron re-runs
 * and duplicate webhook deliveries can't double-create invoices.
 */
export function rebillPeriodStart(planExpiresAt: Date): Date {
  return new Date(planExpiresAt.getTime());
}

/**
 * Grace downgrade boundary (§7.3): downgrade only when STRICTLY after
 * planExpiresAt + 3 days. `==` (exactly at the boundary) → still PRO.
 */
export function shouldDowngrade(planExpiresAt: Date, now: Date): boolean {
  return addDays(planExpiresAt, BILLING_GRACE_DAYS).getTime() < now.getTime();
}

/**
 * Re-bill window (§7.2): period ends within the next 24h (or is already
 * past — grace). planExpiresAt == null (permanent PRO) is handled by the
 * caller, never reaching this helper.
 */
export function shouldRebill(planExpiresAt: Date, now: Date): boolean {
  return planExpiresAt.getTime() <= now.getTime() + REBILL_WINDOW_HOURS * 3_600_000;
}

/**
 * Continuous renewal (§4.2): new expiry = max(planExpiresAt ?? now, now) + 30d.
 * A payment made during grace extends from NOW (not from the lapsed period
 * end), so the tenant never loses days; a payment made early extends from
 * the current expiry, keeping periods continuous.
 */
export function nextExpiry(current: Date | null, now: Date): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addDays(base, BILLING_PERIOD_DAYS);
}

/**
 * Idempotency key for a Payment: `pay_<tenantId>_<periodStart epochMs>`.
 * Unique at the DB (Payment.externalId) and at Xendit (external_id).
 * epochMs (not ISO) keeps the string within Xendit's external_id charset
 * (alphanumeric + `_`/`-`) and length limits.
 *
 * `attempt` > 1 suffixes the key (`_2`, `_3`, …) so a RE-issued invoice for
 * the SAME period (previous one expired unpaid, or Xendit create failed)
 * gets a fresh external_id — Xendit rejects duplicate external_ids, and the
 * cron "no PENDING payment for this period" check keys on periodStart, not
 * the external id, so retries stay idempotent.
 */
export function buildExternalId(tenantId: string, periodStart: Date, attempt = 1): string {
  const base = `pay_${tenantId}_${periodStart.getTime()}`;
  return attempt <= 1 ? base : `${base}_${attempt}`;
}
