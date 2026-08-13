// @vitest-environment node
/**
 * T25-1 — STATUS_LABELS + SPRINT_STATUS_LABELS unit tests (src/types/admin.ts).
 * Pure data maps, no DB. Asserts all status keys are covered and the values
 * are Indonesian per plan ITEM 2 translation table.
 */
import { describe, it, expect } from "vitest";
import { STATUS_LABELS, SPRINT_STATUS_LABELS } from "../src/types/admin";
import type { OrderStatus, SprintStatus } from "../src/types/admin";

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "BREWING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "CANCELLED",
];

describe("T25-1 — STATUS_LABELS", () => {
  it("covers all 6 OrderStatus keys", () => {
    for (const status of ORDER_STATUSES) {
      expect(STATUS_LABELS, `missing label for ${status}`).toHaveProperty(status);
    }
  });

  it("has no extra keys beyond OrderStatus", () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it("uses Indonesian values per plan translation table", () => {
    expect(STATUS_LABELS.PENDING).toBe("Menunggu Konfirmasi");
    expect(STATUS_LABELS.CONFIRMED).toBe("Dikonfirmasi");
    expect(STATUS_LABELS.BREWING).toBe("Diracik");
    expect(STATUS_LABELS.READY_FOR_PICKUP).toBe("Siap Diambil");
    expect(STATUS_LABELS.PICKED_UP).toBe("Selesai");
    expect(STATUS_LABELS.CANCELLED).toBe("Dibatalkan");
  });

  it("contains no untranslated English labels (Confirmed/Brewing/Ready/Picked up/Cancelled)", () => {
    const values = Object.values(STATUS_LABELS).join(" ");
    expect(values).not.toMatch(/\bConfirmed\b/);
    expect(values).not.toMatch(/\bBrewing\b/);
    expect(values).not.toMatch(/\bReady\b/);
    expect(values).not.toMatch(/\bPicked up\b/);
    expect(values).not.toMatch(/\bCancelled\b/);
  });
});

describe("T25-1 — SPRINT_STATUS_LABELS", () => {
  it("covers both SprintStatus keys with Indonesian values", () => {
    const SPRINTS: SprintStatus[] = ["OPEN", "CLOSED"];
    for (const s of SPRINTS) {
      expect(SPRINT_STATUS_LABELS, `missing label for ${s}`).toHaveProperty(s);
    }
    expect(SPRINT_STATUS_LABELS.OPEN).toBe("Buka");
    expect(SPRINT_STATUS_LABELS.CLOSED).toBe("Tutup");
  });
});
