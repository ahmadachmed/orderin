// @vitest-environment node
/**
 * SETTINGS-05 — formatTimeInTimezone unit tests (src/lib/time.ts).
 * Pure function, no DB. Converts a UTC "HH:mm" string to the tenant's
 * timezone for display, with graceful fallbacks.
 */
import { describe, it, expect } from "vitest";
import {
  formatTimeInTimezone,
  localToUtcHHmm,
  isOvernightHours,
  formatOperatingHours,
} from "../src/lib/time";

describe("SETTINGS-05 — formatTimeInTimezone", () => {
  it("converts UTC to Asia/Jakarta (UTC+7): 01:00 UTC → 08:00", () => {
    expect(formatTimeInTimezone("01:00", "Asia/Jakarta")).toBe("08:00");
  });

  it("converts UTC to Asia/Makassar (UTC+8): 01:00 UTC → 09:00", () => {
    expect(formatTimeInTimezone("01:00", "Asia/Makassar")).toBe("09:00");
  });

  it("wraps past midnight: 23:00 UTC → 06:00 Asia/Jakarta (next day)", () => {
    expect(formatTimeInTimezone("23:00", "Asia/Jakarta")).toBe("06:00");
  });

  it("keeps :00 minutes: 05:30 UTC → 12:30 Asia/Jakarta", () => {
    expect(formatTimeInTimezone("05:30", "Asia/Jakarta")).toBe("12:30");
  });

  it("falls back to raw UTC when the timezone is invalid", () => {
    expect(formatTimeInTimezone("01:00", "Not/AZone")).toBe("01:00");
    expect(formatTimeInTimezone("01:00", "")).toBe("01:00");
  });

  it("passes through malformed input unchanged", () => {
    expect(formatTimeInTimezone("abc", "Asia/Jakarta")).toBe("abc");
    expect(formatTimeInTimezone("7:00", "Asia/Jakarta")).toBe("7:00");
    expect(formatTimeInTimezone("", "Asia/Jakarta")).toBe("");
  });
});

describe("T25-2 — isOvernightHours", () => {
  it("returns true when the local range wraps past midnight", () => {
    // 15:00 UTC → 22:00 WIB, 21:00 UTC → 04:00 WIB next day → overnight.
    expect(isOvernightHours("15:00", "21:00", "Asia/Jakarta")).toBe(true);
  });

  it("returns false when the local range is same-day", () => {
    // 01:00 UTC → 08:00 WIB, 13:00 UTC → 20:00 WIB → same day.
    expect(isOvernightHours("01:00", "13:00", "Asia/Jakarta")).toBe(false);
  });

  it("returns false for a range that closes after open in local time", () => {
    // 22:00 UTC → 05:00 WIB, 04:00 UTC → 11:00 WIB. Close (11:00) > open
    // (05:00) post-conversion → same-day, NOT overnight (plan step-2
    // definition: close < open post-conversion).
    expect(isOvernightHours("22:00", "04:00", "Asia/Jakarta")).toBe(false);
  });

  it("falls back to raw UTC comparison on invalid timezone", () => {
    // Invalid tz → formatTimeInTimezone returns raw UTC; 04:00 < 22:00 → overnight.
    expect(isOvernightHours("22:00", "04:00", "Not/AZone")).toBe(true);
  });
});

describe("T25-2 — formatOperatingHours", () => {
  it("formats a same-day range without the overnight flag", () => {
    expect(formatOperatingHours("01:00", "13:00", "Asia/Jakarta")).toEqual({
      openDisplay: "08:00",
      closeDisplay: "20:00",
      isOvernight: false,
    });
  });

  it("formats an overnight range with the overnight flag", () => {
    // 15:00 UTC → 22:00 WIB, 21:00 UTC → 04:00 WIB (next day).
    expect(formatOperatingHours("15:00", "21:00", "Asia/Jakarta")).toEqual({
      openDisplay: "22:00",
      closeDisplay: "04:00",
      isOvernight: true,
    });
  });

  it("falls back to raw UTC strings on invalid timezone", () => {
    expect(formatOperatingHours("22:00", "04:00", "Not/AZone")).toEqual({
      openDisplay: "22:00",
      closeDisplay: "04:00",
      isOvernight: true, // raw UTC close < open
    });
  });
});

describe("localToUtcHHmm — local → UTC inverse of formatTimeInTimezone", () => {
  it("converts Asia/Makassar (UTC+8) local 15:00 → 07:00 UTC", () => {
    expect(localToUtcHHmm("15:00", "Asia/Makassar")).toBe("07:00");
  });

  it("converts Asia/Jakarta (UTC+7) local 08:00 → 01:00 UTC", () => {
    expect(localToUtcHHmm("08:00", "Asia/Jakarta")).toBe("01:00");
  });

  it("is identity for UTC timezone", () => {
    expect(localToUtcHHmm("07:00", "UTC")).toBe("07:00");
  });

  it("wraps past midnight: Asia/Makassar local 05:00 → 21:00 UTC (prev day)", () => {
    expect(localToUtcHHmm("05:00", "Asia/Makassar")).toBe("21:00");
  });

  it("round-trips: formatTimeInTimezone(localToUtcHHmm(x)) === x for each tz", () => {
    const cases = ["00:00", "01:30", "07:00", "12:00", "15:00", "21:00", "23:59"];
    for (const tz of ["Asia/Makassar", "Asia/Jakarta", "UTC"]) {
      for (const local of cases) {
        expect(formatTimeInTimezone(localToUtcHHmm(local, tz), tz)).toBe(local);
      }
    }
  });

  it("falls back to raw input when the timezone is invalid", () => {
    expect(localToUtcHHmm("15:00", "Not/AZone")).toBe("15:00");
    expect(localToUtcHHmm("15:00", "")).toBe("15:00");
  });

  it("passes through malformed input unchanged", () => {
    expect(localToUtcHHmm("abc", "Asia/Jakarta")).toBe("abc");
    expect(localToUtcHHmm("7:00", "Asia/Jakarta")).toBe("7:00");
    expect(localToUtcHHmm("", "Asia/Jakarta")).toBe("");
  });
});
