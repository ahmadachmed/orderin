/**
 * SETTINGS-05 — formatTimeInTimezone unit tests (src/lib/time.ts).
 * Pure function, no DB. Converts a UTC "HH:mm" string to the tenant's
 * timezone for display, with graceful fallbacks.
 */
import { describe, it, expect } from "vitest";
import { formatTimeInTimezone } from "../src/lib/time";

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
