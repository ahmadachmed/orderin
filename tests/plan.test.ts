// @vitest-environment node
/**
 * Monetisation Phase 1 / T6 — unit tests for lib/plan.ts (issue #229).
 *
 * Pure-function tests only — no DB, no mocks, no network. Covers:
 * - PLAN_FEATURES values for FREE vs PRO (issue #229 spec)
 * - can() boolean flags (showBadge, upsellBanner)
 * - getLimit() numeric limits (menuCap, orderPerMonth, maxQueueSize, sprintRetentionDays)
 * - getLimitOrNull() — Infinity → null coercion
 * - effectiveMaxQueueSize() — plan ceiling vs tenant column, boundary cases
 */
import { describe, it, expect } from "vitest";
import {
  Plan,
  PLAN_FEATURES,
  UNLIMITED,
  can,
  getLimit,
  getLimitOrNull,
  effectiveMaxQueueSize,
  type LimitFeature,
  type BooleanFeature,
} from "../src/lib/plan";

// ─────────────────────────────────────────────────────────────────────
// PLAN_FEATURES — static values per issue #229
// ─────────────────────────────────────────────────────────────────────

describe("PLAN_FEATURES", () => {
  it("FREE plan has the spec values from issue #229", () => {
    expect(PLAN_FEATURES[Plan.FREE]).toEqual({
      menuCap: 25,
      orderPerMonth: 300,
      maxQueueSize: 20,
      sprintRetentionDays: 1,
      showBadge: true,
      upsellBanner: true,
    });
  });

  it("PRO plan has the spec values from issue #229", () => {
    const pro = PLAN_FEATURES[Plan.PRO];
    expect(pro.maxQueueSize).toBe(100);
    expect(pro.sprintRetentionDays).toBe(30);
    expect(pro.showBadge).toBe(false);
    expect(pro.upsellBanner).toBe(false);
    // unlimited limits use Infinity sentinel
    expect(pro.menuCap).toBe(Infinity);
    expect(pro.orderPerMonth).toBe(Infinity);
  });

  it("UNLIMITED is Number.POSITIVE_INFINITY", () => {
    expect(UNLIMITED).toBe(Number.POSITIVE_INFINITY);
  });

  it("has exactly two plans: FREE and PRO", () => {
    expect(Object.keys(PLAN_FEATURES).sort()).toEqual(["FREE", "PRO"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// can() — boolean feature flags
// ─────────────────────────────────────────────────────────────────────

describe("can()", () => {
  it("showBadge is true for FREE, false for PRO", () => {
    expect(can(Plan.FREE, "showBadge")).toBe(true);
    expect(can(Plan.PRO, "showBadge")).toBe(false);
  });

  it("upsellBanner is true for FREE, false for PRO", () => {
    expect(can(Plan.FREE, "upsellBanner")).toBe(true);
    expect(can(Plan.PRO, "upsellBanner")).toBe(false);
  });

  it("returns a boolean (not truthy/falsy)", () => {
    const result = can(Plan.FREE, "showBadge");
    expect(typeof result).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────
// getLimit() — numeric limits
// ─────────────────────────────────────────────────────────────────────

describe("getLimit()", () => {
  it("FREE menuCap is 25", () => {
    expect(getLimit(Plan.FREE, "menuCap")).toBe(25);
  });

  it("FREE orderPerMonth is 300", () => {
    expect(getLimit(Plan.FREE, "orderPerMonth")).toBe(300);
  });

  it("FREE maxQueueSize is 20", () => {
    expect(getLimit(Plan.FREE, "maxQueueSize")).toBe(20);
  });

  it("FREE sprintRetentionDays is 1", () => {
    expect(getLimit(Plan.FREE, "sprintRetentionDays")).toBe(1);
  });

  it("PRO menuCap is Infinity (unlimited)", () => {
    expect(getLimit(Plan.PRO, "menuCap")).toBe(Infinity);
  });

  it("PRO orderPerMonth is Infinity (unlimited)", () => {
    expect(getLimit(Plan.PRO, "orderPerMonth")).toBe(Infinity);
  });

  it("PRO maxQueueSize is 100", () => {
    expect(getLimit(Plan.PRO, "maxQueueSize")).toBe(100);
  });

  it("PRO sprintRetentionDays is 30", () => {
    expect(getLimit(Plan.PRO, "sprintRetentionDays")).toBe(30);
  });

  it("returns a number for every limit feature", () => {
    const limits: LimitFeature[] = [
      "menuCap",
      "orderPerMonth",
      "maxQueueSize",
      "sprintRetentionDays",
    ];
    for (const plan of [Plan.FREE, Plan.PRO] as const) {
      for (const limit of limits) {
        const val = getLimit(plan, limit);
        expect(typeof val).toBe("number");
        // Infinity is still typeof "number" in JS
        expect(Number.isFinite(val) || val === Infinity).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// getLimitOrNull() — Infinity → null coercion
// ─────────────────────────────────────────────────────────────────────

describe("getLimitOrNull()", () => {
  it("returns the numeric value for finite limits", () => {
    expect(getLimitOrNull(Plan.FREE, "menuCap")).toBe(25);
    expect(getLimitOrNull(Plan.FREE, "orderPerMonth")).toBe(300);
    expect(getLimitOrNull(Plan.FREE, "maxQueueSize")).toBe(20);
    expect(getLimitOrNull(Plan.FREE, "sprintRetentionDays")).toBe(1);
  });

  it("returns null for unlimited (Infinity) limits", () => {
    expect(getLimitOrNull(Plan.PRO, "menuCap")).toBeNull();
    expect(getLimitOrNull(Plan.PRO, "orderPerMonth")).toBeNull();
  });

  it("returns a real number for PRO maxQueueSize (100, not unlimited)", () => {
    expect(getLimitOrNull(Plan.PRO, "maxQueueSize")).toBe(100);
  });

  it("returns 30 for PRO sprintRetentionDays", () => {
    expect(getLimitOrNull(Plan.PRO, "sprintRetentionDays")).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────
// effectiveMaxQueueSize() — plan ceiling vs tenant column
// ─────────────────────────────────────────────────────────────────────

describe("effectiveMaxQueueSize()", () => {
  it("FREE tenant at ceiling (20) → 20", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.FREE, maxQueueSize: 20 })
    ).toBe(20);
  });

  it("FREE tenant above ceiling (50) → capped to 20", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.FREE, maxQueueSize: 50 })
    ).toBe(20);
  });

  it("FREE tenant below ceiling (10) → 10 (honours tenant value)", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.FREE, maxQueueSize: 10 })
    ).toBe(10);
  });

  it("FREE tenant at 0 → 0 (edge case: no queue)", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.FREE, maxQueueSize: 0 })
    ).toBe(0);
  });

  it("PRO tenant at ceiling (100) → 100", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.PRO, maxQueueSize: 100 })
    ).toBe(100);
  });

  it("PRO tenant above ceiling (200) → capped to 100", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.PRO, maxQueueSize: 200 })
    ).toBe(100);
  });

  it("PRO tenant below ceiling (50) → 50 (honours tenant value)", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.PRO, maxQueueSize: 50 })
    ).toBe(50);
  });

  it("PRO tenant below FREE ceiling (15) → 15 (PRO can go lower than FREE cap)", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.PRO, maxQueueSize: 15 })
    ).toBe(15);
  });

  it("boundary: FREE at exactly ceiling (20) = PRO at exactly 20", () => {
    const freeCap = effectiveMaxQueueSize({ plan: Plan.FREE, maxQueueSize: 20 });
    const proCap = effectiveMaxQueueSize({ plan: Plan.PRO, maxQueueSize: 20 });
    expect(freeCap).toBe(proCap);
  });

  it("boundary: FREE at 21 → 20 (just over the cap)", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.FREE, maxQueueSize: 21 })
    ).toBe(20);
  });

  it("boundary: PRO at 99 → 99 (just under ceiling)", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.PRO, maxQueueSize: 99 })
    ).toBe(99);
  });

  it("boundary: PRO at 101 → 100 (just over ceiling)", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.PRO, maxQueueSize: 101 })
    ).toBe(100);
  });

  it("returns 0 for maxQueueSize 0 on both plans", () => {
    expect(
      effectiveMaxQueueSize({ plan: Plan.FREE, maxQueueSize: 0 })
    ).toBe(0);
    expect(
      effectiveMaxQueueSize({ plan: Plan.PRO, maxQueueSize: 0 })
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cross-check: can() and getLimit() read from PLAN_FEATURES
// ─────────────────────────────────────────────────────────────────────

describe("consistency: functions read from PLAN_FEATURES", () => {
  it("can() matches PLAN_FEATURES for all boolean features", () => {
    const boolFeatures: BooleanFeature[] = ["showBadge", "upsellBanner"];
    for (const plan of [Plan.FREE, Plan.PRO] as const) {
      for (const f of boolFeatures) {
        expect(can(plan, f)).toBe(PLAN_FEATURES[plan][f]);
      }
    }
  });

  it("getLimit() matches PLAN_FEATURES for all numeric limits", () => {
    const limits: LimitFeature[] = [
      "menuCap",
      "orderPerMonth",
      "maxQueueSize",
      "sprintRetentionDays",
    ];
    for (const plan of [Plan.FREE, Plan.PRO] as const) {
      for (const l of limits) {
        expect(getLimit(plan, l)).toBe(PLAN_FEATURES[plan][l]);
      }
    }
  });
});
