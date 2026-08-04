// @vitest-environment node
/**
 * Queue & ETA unit tests — issue #8 critical path (PLAN §4.2, lib/queue.ts).
 * Pure functions only; no DB required.
 */
import { describe, it, expect } from "vitest";
import {
  prepSecondsForItems,
  sortQueue,
  etaForOrderInQueue,
  etaForNewOrder,
  isQueueFull,
  withBuffer,
} from "../src/lib/queue";
import { isWithinHours } from "../src/lib/time";

describe("prepSecondsForItems", () => {
  it("sums prep_time × qty across items", () => {
    const items = [
      { quantity: 2, menuItem: { prepTimeSeconds: 600 } },
      { quantity: 1, menuItem: { prepTimeSeconds: 300 } },
    ];
    expect(prepSecondsForItems(items)).toBe(1500);
  });

  it("returns 0 for an empty item list", () => {
    expect(prepSecondsForItems([])).toBe(0);
  });
});

describe("sortQueue", () => {
  it("orders oldest first (FIFO)", () => {
    const old = { id: "b", createdAt: new Date("2026-08-01T00:00:00Z") };
    const mid = { id: "a", createdAt: new Date("2026-08-01T00:05:00Z") };
    const young = { id: "c", createdAt: new Date("2026-08-01T00:10:00Z") };
    expect(sortQueue([young, mid, old]).map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks equal timestamps by id (deterministic)", () => {
    const t = new Date("2026-08-01T00:00:00Z");
    const x = { id: "x", createdAt: t };
    const y = { id: "y", createdAt: t };
    expect(sortQueue([y, x]).map((e) => e.id)).toEqual(["x", "y"]);
  });

  it("does not mutate the input array", () => {
    const input = [{ id: "a", createdAt: new Date("2026-08-01T00:00:00Z") }];
    sortQueue(input);
    expect(input).toHaveLength(1);
  });
});

describe("etaForOrderInQueue", () => {
  const queue = [
    { id: "o1", createdAt: new Date("2026-08-01T00:00:00Z"), prepSeconds: 600 },
    { id: "o2", createdAt: new Date("2026-08-01T00:05:00Z"), prepSeconds: 300 },
    { id: "o3", createdAt: new Date("2026-08-01T00:10:00Z"), prepSeconds: 900 },
  ];

  it("first order: only its own prep", () => {
    expect(etaForOrderInQueue(queue, "o1")).toBe(600);
  });

  it("middle order: ahead + own", () => {
    expect(etaForOrderInQueue(queue, "o2")).toBe(900);
  });

  it("last order: full queue sum", () => {
    expect(etaForOrderInQueue(queue, "o3")).toBe(1800);
  });

  it("returns null when the order is not in the queue", () => {
    expect(etaForOrderInQueue(queue, "ghost")).toBeNull();
  });
});

describe("etaForNewOrder", () => {
  it("sums everything currently in the queue + own prep", () => {
    const queue = [
      { id: "o1", createdAt: new Date("2026-08-01T00:00:00Z"), prepSeconds: 600 },
      { id: "o2", createdAt: new Date("2026-08-01T00:05:00Z"), prepSeconds: 300 },
    ];
    expect(etaForNewOrder(queue, 900)).toBe(1800);
  });

  it("empty queue → own prep only", () => {
    expect(etaForNewOrder([], 600)).toBe(600);
  });
});

describe("isQueueFull", () => {
  it("full at exactly maxQueueSize", () => {
    expect(isQueueFull(20, 20)).toBe(true);
  });
  it("not full below the cap", () => {
    expect(isQueueFull(19, 20)).toBe(false);
  });
  it("full beyond the cap", () => {
    expect(isQueueFull(21, 20)).toBe(true);
  });
});

describe("withBuffer", () => {
  it("folds minutes into seconds", () => {
    expect(withBuffer(600, 5)).toBe(900);
  });
  it("zero buffer is a no-op", () => {
    expect(withBuffer(600, 0)).toBe(600);
  });
});

describe("isWithinHours", () => {
  const noon = new Date("2026-08-01T12:00:00Z"); // 12:00 UTC

  it("inside normal range", () => {
    expect(isWithinHours("07:00", "21:00", noon)).toBe(true);
  });
  it("before open", () => {
    expect(isWithinHours("13:00", "21:00", noon)).toBe(false);
  });
  it("after close", () => {
    expect(isWithinHours("07:00", "11:00", noon)).toBe(false);
  });
  it("close boundary is exclusive", () => {
    expect(isWithinHours("07:00", "12:00", noon)).toBe(false);
  });
  it("open boundary is inclusive", () => {
    expect(isWithinHours("12:00", "21:00", noon)).toBe(true);
  });
  it("overnight range wraps past midnight", () => {
    expect(isWithinHours("22:00", "06:00", noon)).toBe(false);
    const night = new Date("2026-08-01T23:30:00Z");
    expect(isWithinHours("22:00", "06:00", night)).toBe(true);
    const dawn = new Date("2026-08-01T05:00:00Z");
    expect(isWithinHours("22:00", "06:00", dawn)).toBe(true);
  });
});
