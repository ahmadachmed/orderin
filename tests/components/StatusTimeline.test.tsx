// @vitest-environment jsdom
/**
 * STATUS-05 — StatusTimeline component tests (docs/T18-plan.md GAP 4 / issue #150).
 * PAID log entries (status PENDING + note "Marked PAID via dashboard") must render
 * the note as a secondary line so the entry is not a misleading "Pesanan dibuat"
 * duplicate. Non-PAID PENDING logs keep rendering "Pesanan dibuat" (backward compat).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusTimeline from "@/components/StatusTimeline";
import { StatusLogEntry } from "@/types";

const baseEntry: StatusLogEntry = {
  id: "log-1",
  status: "PENDING",
  actorType: "system",
  actorName: "customer",
  note: null,
  createdAt: "2026-08-04T08:00:00.000Z",
};

describe("StatusTimeline", () => {
  it("renders note as secondary line for PAID log entries (PENDING + note contains PAID)", () => {
    render(
      <StatusTimeline
        logs={[
          { ...baseEntry, id: "log-create", actorName: "customer" },
          {
            ...baseEntry,
            id: "log-paid",
            actorName: "admin",
            note: "Marked PAID via dashboard",
            createdAt: "2026-08-04T08:05:00.000Z",
          },
        ]}
      />
    );
    // PAID entry still labels the underlying status, but the note disambiguates it
    expect(screen.getAllByText("Pesanan dibuat")).toHaveLength(2);
    expect(screen.getByText("Marked PAID via dashboard")).toBeInTheDocument();
  });

  it("does not render a note line when note is null (backward compatible)", () => {
    render(<StatusTimeline logs={[baseEntry]} />);
    expect(screen.getByText("Pesanan dibuat")).toBeInTheDocument();
    expect(screen.queryByText("Marked PAID via dashboard")).not.toBeInTheDocument();
  });

  it("renders nothing when logs are empty", () => {
    const { container } = render(<StatusTimeline logs={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
