// @vitest-environment jsdom
/**
 * Monetisasi Phase 1 / T12 (issue #229) — UpsellBanner component tests.
 *
 * Verifies:
 *   - Banner renders on FREE plan (upsellBanner=true).
 *   - Banner is hidden on PRO plan (upsellBanner=false).
 *   - Banner is hidden when previously dismissed (localStorage flag).
 *   - Clicking the dismiss button hides the banner and persists to localStorage.
 *   - Banner renders nothing while settings are still loading (no flash).
 *   - Banner renders nothing when fetchSettings fails (graceful degradation).
 *   - No payment/upgrade link is present (Phase 3 out of scope).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UpsellBanner from "@/components/admin/UpsellBanner";
import { fetchSettings } from "@/lib/admin-api";
import type { TenantSettings } from "@/types/admin";

vi.mock("@/lib/admin-api", () => ({
  fetchSettings: vi.fn(),
}));

const fetchSettingsMock = vi.mocked(fetchSettings);

const FREE_SETTINGS: TenantSettings = {
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
  plan: "FREE",
  planExpiresAt: null,
  isActive: true,
  contactEmail: null,
};

const PRO_SETTINGS: TenantSettings = {
  ...FREE_SETTINGS,
  plan: "PRO",
};

beforeEach(() => {
  fetchSettingsMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UpsellBanner (T12)", () => {
  it("renders the banner on FREE plan", async () => {
    fetchSettingsMock.mockResolvedValue(FREE_SETTINGS);

    render(<UpsellBanner />);

    await waitFor(() =>
      expect(
        screen.getByText("Tingkatkan ke paket PRO"),
      ).toBeInTheDocument(),
    );

    // Should mention plan benefits without a payment link.
    expect(screen.getByText(/menu tanpa batas/i)).toBeInTheDocument();
    expect(screen.getByText(/retensi sprint 30 hari/i)).toBeInTheDocument();
    // CTA text must NOT include upgrade/payment links (Phase 3 out of scope).
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/bayar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upgrade sekarang/i)).not.toBeInTheDocument();
  });

  it("hides the banner on PRO plan", async () => {
    fetchSettingsMock.mockResolvedValue(PRO_SETTINGS);

    render(<UpsellBanner />);

    // Wait for the settings to load (component goes from null → plan set).
    await waitFor(() =>
      expect(fetchSettingsMock).toHaveBeenCalledTimes(1),
    );

    // Banner should never appear for PRO.
    expect(
      screen.queryByText("Tingkatkan ke paket PRO"),
    ).not.toBeInTheDocument();
  });

  it("hides the banner when previously dismissed in localStorage", async () => {
    localStorage.setItem("hb:upsell-banner-dismissed", "1");
    fetchSettingsMock.mockResolvedValue(FREE_SETTINGS);

    render(<UpsellBanner />);

    await waitFor(() =>
      expect(fetchSettingsMock).toHaveBeenCalledTimes(1),
    );

    // Even though plan is FREE, the banner is dismissed.
    expect(
      screen.queryByText("Tingkatkan ke paket PRO"),
    ).not.toBeInTheDocument();
  });

  it("dismiss button hides the banner and persists to localStorage", async () => {
    fetchSettingsMock.mockResolvedValue(FREE_SETTINGS);

    render(<UpsellBanner />);

    // Wait for banner to appear.
    const dismissBtn = await screen.findByRole("button", {
      name: "Tutup banner",
    });

    // Before dismiss, localStorage has no key.
    expect(localStorage.getItem("hb:upsell-banner-dismissed")).toBeNull();

    fireEvent.click(dismissBtn);

    // Banner disappears.
    await waitFor(() =>
      expect(
        screen.queryByText("Tingkatkan ke paket PRO"),
      ).not.toBeInTheDocument(),
    );

    // localStorage flag is set.
    expect(localStorage.getItem("hb:upsell-banner-dismissed")).toBe("1");
  });

  it("renders nothing while settings are still loading", () => {
    // Never-resolving promise so component stays in the loading state.
    fetchSettingsMock.mockReturnValue(new Promise(() => {}));

    render(<UpsellBanner />);

    // While loading, the banner must not appear (no flash of content).
    expect(
      screen.queryByText("Tingkatkan ke paket PRO"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders nothing when fetchSettings fails", async () => {
    fetchSettingsMock.mockRejectedValue(new Error("Network error"));

    render(<UpsellBanner />);

    await waitFor(() =>
      expect(fetchSettingsMock).toHaveBeenCalledTimes(1),
    );

    // On error, the banner should not appear (graceful degradation).
    expect(
      screen.queryByText("Tingkatkan ke paket PRO"),
    ).not.toBeInTheDocument();
  });
});
