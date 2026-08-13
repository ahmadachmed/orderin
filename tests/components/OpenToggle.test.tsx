// @vitest-environment jsdom
/**
 * T28 ITEM 3 (issue #196) — Header "Buka Toko / Tutup Toko" toggle tests.
 *   - renders current state from fetchSettings().isOpen
 *   - clicking the inactive segment calls updateSettings({ isOpen: !isOpen })
 *   - reflects the new state returned by PATCH
 *   - shows an inline error when the PATCH fails (state rolls back)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OpenToggle from "@/components/admin/OpenToggle";
import { fetchSettings, updateSettings } from "@/lib/admin-api";
import type { TenantSettings } from "@/types/admin";

vi.mock("@/lib/admin-api", () => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const fetchSettingsMock = vi.mocked(fetchSettings);
const updateSettingsMock = vi.mocked(updateSettings);

const OPEN_SETTINGS: TenantSettings = {
  id: "tnt_1",
  slug: "kopi-senja",
  name: "Kopi Senja",
  isOpen: true,
  openTime: "07:00",
  closeTime: "21:00",
  timezone: "Asia/Makassar",
  maxQueueSize: 20,
  prepTimeBuffer: 0,
  sprintDurationDays: 1,
  qrisImageUrl: null,
  qrisCode: null,
  bankAccountNumber: null,
  bankName: null,
};

const CLOSED_SETTINGS: TenantSettings = {
  ...OPEN_SETTINGS,
  isOpen: false,
};

beforeEach(() => {
  fetchSettingsMock.mockReset();
  updateSettingsMock.mockReset();
});

describe("OpenToggle", () => {
  it("renders current state from fetchSettings().isOpen", async () => {
    fetchSettingsMock.mockResolvedValue(OPEN_SETTINGS);

    render(<OpenToggle />);
    await screen.findByRole("button", { name: "Buka Toko" });

    expect(screen.getByRole("button", { name: "Buka Toko" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Tutup Toko" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking the inactive segment calls updateSettings({ isOpen: !isOpen })", async () => {
    fetchSettingsMock.mockResolvedValue(OPEN_SETTINGS);
    updateSettingsMock.mockResolvedValue(CLOSED_SETTINGS);

    render(<OpenToggle />);
    await screen.findByRole("button", { name: "Buka Toko" });

    fireEvent.click(screen.getByRole("button", { name: "Tutup Toko" }));

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({ isOpen: false }),
    );
  });

  it("reflects the new state returned by PATCH", async () => {
    fetchSettingsMock.mockResolvedValue(OPEN_SETTINGS);
    updateSettingsMock.mockResolvedValue(CLOSED_SETTINGS);

    render(<OpenToggle />);
    await screen.findByRole("button", { name: "Buka Toko" });

    fireEvent.click(screen.getByRole("button", { name: "Tutup Toko" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Tutup Toko" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("button", { name: "Buka Toko" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows an inline error and rolls back when the PATCH fails", async () => {
    fetchSettingsMock.mockResolvedValue(OPEN_SETTINGS);
    updateSettingsMock.mockRejectedValue(new Error("Gagal menyimpan"));

    render(<OpenToggle />);
    await screen.findByRole("button", { name: "Buka Toko" });

    fireEvent.click(screen.getByRole("button", { name: "Tutup Toko" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal menyimpan");
    // rolled back to the previous state
    expect(screen.getByRole("button", { name: "Buka Toko" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reports a load failure via inline error", async () => {
    fetchSettingsMock.mockRejectedValue(new Error("401 Unauthorized"));

    render(<OpenToggle />);

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("401 Unauthorized");
  });
});
