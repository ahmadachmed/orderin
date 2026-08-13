// @vitest-environment node
/**
 * T25-1 — STATUS_LABELS + SPRINT_STATUS_LABELS unit tests (src/types/admin.ts).
 * Pure data maps, no DB. Asserts all status keys are covered and the values
 * are Indonesian per plan ITEM 2 translation table.
 */
import { describe, it, expect } from "vitest";
import { ACTION_LABELS, STATUS_LABELS, SPRINT_STATUS_LABELS } from "../src/types/admin";
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

describe("T28 ITEM 4 — ACTION_LABELS", () => {
  it("covers every forward transition in STATUS_FLOW with an imperative verb", () => {
    // STATUS_FLOW: PENDING → CONFIRMED → BREWING → READY_FOR_PICKUP → PICKED_UP.
    // Every transition target except the terminal PICKED_UP must have an action label.
    const transitions: OrderStatus[] = ["CONFIRMED", "BREWING", "READY_FOR_PICKUP", "PICKED_UP"];
    for (const target of transitions) {
      expect(ACTION_LABELS, `missing action label for ${target}`).toHaveProperty(target);
    }
  });

  it("uses imperative verbs per plan ITEM 4 (distinct from STATUS_LABELS)", () => {
    expect(ACTION_LABELS.CONFIRMED).toBe("Konfirmasi");
    expect(ACTION_LABELS.BREWING).toBe("Mulai Meracik");
    expect(ACTION_LABELS.READY_FOR_PICKUP).toBe("Tandai Siap");
    expect(ACTION_LABELS.PICKED_UP).toBe("Selesai");
    // The action verb must differ from the past-participle state label —
    // e.g. "Mulai Meracik" (action) vs "Diracik" (state), "Tandai Siap" vs
    // "Siap Diambil" (D5: both wording families coexist by design).
    for (const status of ["CONFIRMED", "BREWING", "READY_FOR_PICKUP"] as const) {
      expect(ACTION_LABELS[status]).not.toBe(STATUS_LABELS[status]);
    }
  });

  it("has no keys outside the forward transitions", () => {
    expect(Object.keys(ACTION_LABELS).sort()).toEqual(
      ["CONFIRMED", "BREWING", "READY_FOR_PICKUP", "PICKED_UP"].sort()
    );
  });
});
