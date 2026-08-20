// @vitest-environment jsdom
/**
 * Monetisation Phase 3 / T20 — BillingCard component tests (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §8.2 / §10.
 *
 * Three states driven by GET /api/billing/status (mocked via @/lib/admin-api):
 *   FREE   → badge FREE + "Bayar Rp99.000" → POST upgrade → redirect
 *   PRO    → "Otomatis diperpanjang" + expiry, no pay button
 *   PRO grace → amber banner + "Bayar tagihan"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillingCard from "@/components/admin/BillingCard";
import { fetchBillingStatus, startProUpgrade } from "@/lib/admin-api";
import type { BillingStatus } from "@/types/admin";

vi.mock("@/lib/admin-api", () => ({
  fetchBillingStatus: vi.fn(),
  startProUpgrade: vi.fn(),
}));

const FREE_STATUS: BillingStatus = {
  plan: "FREE",
  planExpiresAt: null,
  inGrace: false,
  latestPayments: [],
};
const PRO_STATUS: BillingStatus = {
  plan: "PRO",
  planExpiresAt: "2026-09-20T00:00:00.000Z",
  inGrace: false,
  latestPayments: [],
};
const GRACE_STATUS: BillingStatus = {
  plan: "PRO",
  planExpiresAt: "2026-08-10T00:00:00.000Z",
  inGrace: true,
  latestPayments: [],
};

function mockStatus(status: BillingStatus) {
  (fetchBillingStatus as ReturnType<typeof vi.fn>).mockResolvedValue(status);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStatus(FREE_STATUS);
});

describe("FREE tenant", () => {
  it("shows the FREE badge and a pay button with the price", async () => {
    render(<BillingCard />);
    expect(await screen.findByTestId("billing-plan-badge")).toHaveTextContent("FREE");
    const button = await screen.findByTestId("pay-button");
    expect(button).toHaveTextContent(/Rp\s?99\.000/);
    expect(button).not.toBeDisabled();
  });

  it("no grace banner for FREE", async () => {
    render(<BillingCard />);
    await screen.findByTestId("billing-plan-badge");
    expect(screen.queryByTestId("grace-banner")).not.toBeInTheDocument();
  });

  it("clicking pay calls POST /api/billing/upgrade and redirects to invoiceUrl", async () => {
    (startProUpgrade as ReturnType<typeof vi.fn>).mockResolvedValue({
      invoiceUrl: "https://app.duitku.com/payment/DUITKU_1",
      paymentId: "pay_1",
    });
    const loc = { href: "" };
    Object.defineProperty(window, "location", { value: loc, writable: true });

    render(<BillingCard />);
    fireEvent.click(await screen.findByTestId("pay-button"));
    await waitFor(() => expect(loc.href).toBe("https://app.duitku.com/payment/DUITKU_1"));
    expect(startProUpgrade).toHaveBeenCalledTimes(1);
  });

  it("surfaces the API error message when the upgrade fails", async () => {
    (startProUpgrade as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Duitku error (API_VALIDATION_ERROR)"));
    render(<BillingCard />);
    fireEvent.click(await screen.findByTestId("pay-button"));
    expect(await screen.findByText(/Duitku error/)).toBeInTheDocument();
  });
});

describe("PRO tenant (active)", () => {
  it("shows the PRO badge + auto-renew text, no pay button", async () => {
    mockStatus(PRO_STATUS);
    render(<BillingCard />);
    expect(await screen.findByTestId("billing-plan-badge")).toHaveTextContent("PRO");
    expect(await screen.findByText(/Otomatis diperpanjang tiap bulan/)).toBeInTheDocument();
    expect(screen.queryByTestId("pay-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("grace-banner")).not.toBeInTheDocument();
  });

  it("renders the expiry date", async () => {
    mockStatus(PRO_STATUS);
    render(<BillingCard />);
    expect(await screen.findByText(/20 September 2026/)).toBeInTheDocument();
  });
});

describe("PRO tenant in grace", () => {
  it("shows the grace banner + pay button, no auto-renew text", async () => {
    mockStatus(GRACE_STATUS);
    render(<BillingCard />);
    expect(await screen.findByTestId("grace-banner")).toHaveTextContent(/Langganan berakhir/);
    const button = await screen.findByTestId("pay-button");
    expect(button).toHaveTextContent("Bayar tagihan");
    expect(screen.queryByText(/Otomatis diperpanjang tiap bulan/)).not.toBeInTheDocument();
  });
});

describe("loading state", () => {
  it("shows a loading placeholder before status resolves", () => {
    (fetchBillingStatus as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => undefined));
    render(<BillingCard />);
    expect(screen.getByText("Memuat status langganan…")).toBeInTheDocument();
  });
});
