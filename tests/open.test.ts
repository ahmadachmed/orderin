/**
 * #207 v2 — unit tests for lib/open.ts (schedule auto + time-boxed toggle
 * override). Pure functions, fixed `now` — no DB.
 */
import { describe, it, expect } from "vitest";
import { effectiveOpen, nextBoundary } from "../src/lib/open";

// Fixed reference instants (UTC). openTime/closeTime are "HH:mm" UTC.
const NOW_MID_WINDOW = new Date("2026-08-14T10:00:00Z"); // between 07:00 and 15:00
const NOW_AFTER_CLOSE = new Date("2026-08-14T20:00:00Z"); // after 15:00
const NOW_LATE_NIGHT = new Date("2026-08-14T23:00:00Z"); // overnight window (14:00–04:00)
const NOW_MID_OVERNIGHT_GAP = new Date("2026-08-14T10:00:00Z"); // outside 14:00–04:00

const OVERRIDE_EXPIRED = new Date("2026-08-13T10:00:00Z"); // yesterday
const OVERRIDE_ACTIVE = new Date("2026-08-15T10:00:00Z"); // tomorrow

const DAY = 86_400_000;

describe("effectiveOpen — override expired → schedule governs", () => {
  it("force-close expires inside the window → auto OPEN (schedule wins)", () => {
    const tenant = {
      isOpen: false, // admin had force-closed
      openTime: "07:00",
      closeTime: "15:00",
      isOpenOverrideUntil: OVERRIDE_EXPIRED,
    };
    expect(effectiveOpen(tenant, NOW_MID_WINDOW)).toBe(true);
  });

  it("force-open expires outside the window → auto CLOSED (schedule wins)", () => {
    const tenant = {
      isOpen: true, // admin had force-opened
      openTime: "07:00",
      closeTime: "15:00",
      isOpenOverrideUntil: OVERRIDE_EXPIRED,
    };
    expect(effectiveOpen(tenant, NOW_AFTER_CLOSE)).toBe(false);
  });

  it("no override at all → pure schedule", () => {
    const tenant = {
      isOpen: false,
      openTime: "07:00",
      closeTime: "15:00",
      isOpenOverrideUntil: null,
    };
    expect(effectiveOpen(tenant, NOW_MID_WINDOW)).toBe(true);
    expect(effectiveOpen(tenant, NOW_AFTER_CLOSE)).toBe(false);
  });
});

describe("effectiveOpen — active override wins", () => {
  it("override OPEN active outside the window → OPEN", () => {
    const tenant = {
      isOpen: true,
      openTime: "07:00",
      closeTime: "15:00",
      isOpenOverrideUntil: OVERRIDE_ACTIVE,
    };
    expect(effectiveOpen(tenant, NOW_AFTER_CLOSE)).toBe(true);
  });

  it("override CLOSED active inside the window → CLOSED", () => {
    const tenant = {
      isOpen: false,
      openTime: "07:00",
      closeTime: "15:00",
      isOpenOverrideUntil: OVERRIDE_ACTIVE,
    };
    expect(effectiveOpen(tenant, NOW_MID_WINDOW)).toBe(false);
  });

  it("override active exactly at its expiry instant → schedule takes over", () => {
    const tenant = {
      isOpen: true,
      openTime: "07:00",
      closeTime: "15:00",
      isOpenOverrideUntil: NOW_AFTER_CLOSE, // override ends exactly now
    };
    // now >= until → override inactive; 20:00 is after 15:00 → closed
    expect(effectiveOpen(tenant, NOW_AFTER_CLOSE)).toBe(false);
  });
});

describe("effectiveOpen — overnight schedule (close < open)", () => {
  const overnight = {
    isOpen: true,
    openTime: "14:00",
    closeTime: "04:00",
    isOpenOverrideUntil: null,
  };

  it("23:00 is inside 14:00–04:00 → OPEN", () => {
    expect(effectiveOpen(overnight, NOW_LATE_NIGHT)).toBe(true);
  });

  it("10:00 is outside 14:00–04:00 → CLOSED", () => {
    expect(effectiveOpen(overnight, NOW_MID_OVERNIGHT_GAP)).toBe(false);
  });

  it("expired force-open at 23:00 overnight → OPEN (schedule)", () => {
    expect(
      effectiveOpen({ ...overnight, isOpen: false, isOpenOverrideUntil: OVERRIDE_EXPIRED }, NOW_LATE_NIGHT),
    ).toBe(true);
  });
});

describe("nextBoundary — next open OR close occurrence", () => {
  it("mid-window → today's closeTime", () => {
    const b = nextBoundary("07:00", "15:00", NOW_MID_WINDOW);
    expect(b.getTime()).toBe(new Date("2026-08-14T15:00:00Z").getTime());
  });

  it("after closeTime → tomorrow's openTime", () => {
    const b = nextBoundary("07:00", "15:00", NOW_AFTER_CLOSE);
    expect(b.getTime()).toBe(new Date("2026-08-15T07:00:00Z").getTime());
  });

  it("exactly at closeTime boundary → next boundary is tomorrow's openTime", () => {
    const atClose = new Date("2026-08-14T15:00:00Z");
    const b = nextBoundary("07:00", "15:00", atClose);
    expect(b.getTime()).toBe(new Date("2026-08-15T07:00:00Z").getTime());
  });

  it("overnight 23:00 (14:00–04:00) → next boundary is 04:00 tomorrow (close)", () => {
    const b = nextBoundary("14:00", "04:00", NOW_LATE_NIGHT);
    expect(b.getTime()).toBe(new Date("2026-08-15T04:00:00Z").getTime());
  });

  it("overnight 10:00 (14:00–04:00) → next boundary is 14:00 today (open)", () => {
    const b = nextBoundary("14:00", "04:00", NOW_MID_OVERNIGHT_GAP);
    expect(b.getTime()).toBe(new Date("2026-08-14T14:00:00Z").getTime());
  });

  it("result is strictly after now and within 24h", () => {
    const now = new Date("2026-08-14T06:30:00Z");
    const b = nextBoundary("07:00", "15:00", now);
    expect(b.getTime()).toBeGreaterThan(now.getTime());
    expect(b.getTime() - now.getTime()).toBeLessThan(DAY);
  });
});
