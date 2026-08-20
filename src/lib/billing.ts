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
 * cron downgrades to FREE. Duitku `expiryPeriod` (4320 min) matches this.
 */
export const BILLING_GRACE_DAYS = 3;
/** Re-bill window: cron opens a new invoice when the period ends within 24h. */
export const REBILL_WINDOW_HOURS = 24;
/**
 * Duitku createInvoice expiryPeriod (minutes) — pay window == grace period
 * (3 days). Channel caps vary (e-wallet e.g. ShopeePay 60 min) but expiry is
 * only a technical bound — the cron (planExpiresAt) is the source of truth.
 */
export const DUITKU_EXPIRY_MINUTES = 4320;

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
 * Unique at the DB (Payment.externalId) and at Duitku (merchantOrderId).
 * epochMs (not ISO) keeps the string within Duitku's merchantOrderId charset
 * (alphanumeric + `_`/`-`) and length limits.
 *
 * NOTE (T21 pitfall): Duitku does not document a merchantOrderId max length;
 * this format is ±55 chars. If the sandbox rejects it, fall back to the
 * compact form `pay_<tenantId.slice(0,8)>_<epochMs>` (still unique — the DB
 * externalId stays the source of truth for idempotency).
 *
 * `attempt` > 1 suffixes the key (`_2`, `_3`, …) so a RE-issued invoice for
 * the SAME period (previous one expired unpaid, or Duitku create failed)
 * gets a fresh merchantOrderId — Duitku rejects duplicate merchantOrderIds,
 * and the cron "no PENDING payment for this period" check keys on
 * periodStart, not the external id, so retries stay idempotent.
 */
export function buildExternalId(tenantId: string, periodStart: Date, attempt = 1): string {
  const base = `pay_${tenantId}_${periodStart.getTime()}`;
  return attempt <= 1 ? base : `${base}_${attempt}`;
}
