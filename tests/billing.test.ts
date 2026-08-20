// @vitest-environment node
/**
 * Monetisation Phase 3 / T20 — unit tests for lib/billing.ts (issue #257).
 *
 * Pure helper tests — no DB, no mocks. Covers the grace/re-bill BOUNDARY
 * spec from the plan doc §4.3 / §7.3 (all comparisons in UTC):
 *   - downgrade ONLY strictly after planExpiresAt + 3 days (== stays PRO)
 *   - re-bill window opens at planExpiresAt <= now + 24h
 *   - continuous renewal: max(planExpiresAt ?? now, now) + 30 days
 *   - externalId shape + retry suffix
 */
import { describe, it, expect } from "vitest";
import {
  PRO_PRICE_IDR,
  BILLING_PERIOD_DAYS,
  BILLING_GRACE_DAYS,
  REBILL_WINDOW_HOURS,
  XENDIT_INVOICE_DURATION_HOURS,
  addDays,
  firstPeriodStart,
  rebillPeriodStart,
  shouldDowngrade,
  shouldRebill,
  nextExpiry,
  buildExternalId,
} from "../src/lib/billing";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NOW = new Date("2026-08-20T12:00:00.000Z");

describe("constants", () => {
  it("price is Rp99.000 per month", () => {
    expect(PRO_PRICE_IDR).toBe(99000);
  });
  it("period 30 days, grace 3 days, invoice duration 72h == grace", () => {
    expect(BILLING_PERIOD_DAYS).toBe(30);
    expect(BILLING_GRACE_DAYS).toBe(3);
    expect(XENDIT_INVOICE_DURATION_HOURS).toBe(72);
  });
  it("re-bill window opens 24h before period end", () => {
    expect(REBILL_WINDOW_HOURS).toBe(24);
  });
});

describe("addDays", () => {
  it("adds N days keeping the same time-of-day (UTC)", () => {
    expect(addDays(NOW, 3).toISOString()).toBe("2026-08-23T12:00:00.000Z");
    expect(addDays(NOW, 30).toISOString()).toBe("2026-09-19T12:00:00.000Z");
  });
});

describe("period starts", () => {
  it("firstPeriodStart = now (fresh upgrade)", () => {
    expect(firstPeriodStart(NOW).getTime()).toBe(NOW.getTime());
  });
  it("rebillPeriodStart = current expiry (continuous periods)", () => {
    const expiry = addDays(NOW, 5);
    expect(rebillPeriodStart(expiry).getTime()).toBe(expiry.getTime());
  });
});

describe("shouldDowngrade — grace boundary (§7.3)", () => {
  it("planExpiresAt + 3d < now → downgrade", () => {
    const expiresAt = new Date(NOW.getTime() - 4 * DAY_MS); // grace ended 1d ago
    expect(shouldDowngrade(expiresAt, NOW)).toBe(true);
  });
  it("EXACTLY at planExpiresAt + 3d → NOT downgraded (== boundary)", () => {
    const expiresAt = new Date(NOW.getTime() - 3 * DAY_MS);
    expect(shouldDowngrade(expiresAt, NOW)).toBe(false);
  });
  it("one ms before the boundary → NOT downgraded", () => {
    const expiresAt = new Date(NOW.getTime() - 3 * DAY_MS + 1);
    expect(shouldDowngrade(expiresAt, NOW)).toBe(false);
  });
  it("one ms after the boundary → downgrade", () => {
    const expiresAt = new Date(NOW.getTime() - 3 * DAY_MS - 1);
    expect(shouldDowngrade(expiresAt, NOW)).toBe(true);
  });
  it("still within grace (planExpiresAt in the past, < 3d) → NOT downgraded", () => {
    const expiresAt = new Date(NOW.getTime() - DAY_MS);
    expect(shouldDowngrade(expiresAt, NOW)).toBe(false);
  });
  it("not yet expired → NOT downgraded", () => {
    expect(shouldDowngrade(addDays(NOW, 1), NOW)).toBe(false);
  });
});

describe("shouldRebill — re-bill window (§7.2)", () => {
  it("period ends in exactly 24h → re-bill (window open at ==)", () => {
    const expiresAt = new Date(NOW.getTime() + 24 * HOUR_MS);
    expect(shouldRebill(expiresAt, NOW)).toBe(true);
  });
  it("period ends in 24h + 1ms → window not open yet", () => {
    const expiresAt = new Date(NOW.getTime() + 24 * HOUR_MS + 1);
    expect(shouldRebill(expiresAt, NOW)).toBe(false);
  });
  it("period ends in 1h → re-bill", () => {
    expect(shouldRebill(new Date(NOW.getTime() + HOUR_MS), NOW)).toBe(true);
  });
  it("already past (grace) → re-bill", () => {
    expect(shouldRebill(new Date(NOW.getTime() - DAY_MS), NOW)).toBe(true);
  });
  it("far in the future (30d) → no re-bill", () => {
    expect(shouldRebill(addDays(NOW, 30), NOW)).toBe(false);
  });
});

describe("nextExpiry — continuous renewal (§4.2)", () => {
  it("no current expiry → now + 30d", () => {
    expect(nextExpiry(null, NOW).getTime()).toBe(NOW.getTime() + 30 * DAY_MS);
  });
  it("current expiry in the future → expiry + 30d (early renewal keeps continuity)", () => {
    const expiry = addDays(NOW, 10);
    expect(nextExpiry(expiry, NOW).getTime()).toBe(expiry.getTime() + 30 * DAY_MS);
  });
  it("current expiry in the past (grace) → now + 30d (max() base)", () => {
    const expiry = new Date(NOW.getTime() - 2 * DAY_MS);
    expect(nextExpiry(expiry, NOW).getTime()).toBe(NOW.getTime() + 30 * DAY_MS);
  });
  it("current expiry exactly now → now + 30d", () => {
    expect(nextExpiry(NOW, NOW).getTime()).toBe(NOW.getTime() + 30 * DAY_MS);
  });
});

describe("buildExternalId", () => {
  it("shape: pay_<tenantId>_<periodStart epochMs>", () => {
    const id = buildExternalId("t-123", NOW);
    expect(id).toBe(`pay_t-123_${NOW.getTime()}`);
  });
  it("attempt 1 has no suffix; attempt > 1 suffixes", () => {
    expect(buildExternalId("t-1", NOW, 1)).toBe(`pay_t-1_${NOW.getTime()}`);
    expect(buildExternalId("t-1", NOW, 2)).toBe(`pay_t-1_${NOW.getTime()}_2`);
    expect(buildExternalId("t-1", NOW, 3)).toBe(`pay_t-1_${NOW.getTime()}_3`);
  });
  it("deterministic for the same period (cron re-run safety)", () => {
    expect(buildExternalId("t-1", NOW)).toBe(buildExternalId("t-1", NOW));
  });
});
