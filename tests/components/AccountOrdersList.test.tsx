// @vitest-environment jsdom
/**
 * T17-11 (docs/T17-hybrid-plan.md §T17-11 "Order history tests") — T17-9 UI:
 * AccountOrdersList client component on /[tenantSlug]/account/orders.
 * Renders the customer's order history fetched from GET /api/customer/orders:
 * loading → empty → order cards, tenant-scoped links, Keluar (logout) button.
 * The server page guard (redirect/404) lives in tests/customer-orders.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccountOrdersList from "@/components/AccountOrdersList";

const tenantSlug = "kopi-senja";
const fetchMock = vi.fn();

const orders = [
  {
    orderId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    status: "PENDING",
    createdAt: "2026-08-04T08:00:00.000Z",
    itemCount: 2,
    summary: "2× Espresso",
  },
  {
    orderId: "11111111-2222-3333-4444-555555555555",
    status: "PICKED_UP",
    createdAt: "2026-08-02T09:30:00.000Z",
    itemCount: 1,
    summary: "1× Kopi Susu Gula Aren",
  },
];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountOrdersList (T17-9)", () => {
  it("shows a loading state, then the empty state", async () => {
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolveFetch = r)));
    render(<AccountOrdersList tenantSlug={tenantSlug} />);
    expect(screen.getByText("Memuat...")).toBeInTheDocument();

    resolveFetch({ json: () => Promise.resolve([]) });
    await waitFor(() =>
      expect(screen.getByText("Belum ada pesanan.")).toBeInTheDocument()
    );
  });

  it("renders order cards with id, summary, item count and status badge", async () => {
    fetchMock.mockResolvedValue({ json: () => Promise.resolve(orders) });
    render(<AccountOrdersList tenantSlug={tenantSlug} />);

    await waitFor(() => expect(screen.getByText("#AAAAAAAA")).toBeInTheDocument());
    expect(screen.getByText("#11111111")).toBeInTheDocument();
    expect(screen.getByText("2× Espresso")).toBeInTheDocument();
    expect(screen.getByText("1× Kopi Susu Gula Aren")).toBeInTheDocument();
    // Status badges (OrderStatusBadge labels).
    expect(screen.getByText("Menunggu konfirmasi")).toBeInTheDocument();
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    // Item count rendered inside the date line.
    expect(screen.getByText(/2 item/)).toBeInTheDocument();
    expect(screen.getByText(/1 item/)).toBeInTheDocument();
  });

  it("links each card to the tenant-scoped order page", async () => {
    fetchMock.mockResolvedValue({ json: () => Promise.resolve(orders) });
    render(<AccountOrdersList tenantSlug={tenantSlug} />);

    await waitFor(() => expect(screen.getByText("#AAAAAAAA")).toBeInTheDocument());
    const link = screen.getByText("#AAAAAAAA").closest("a");
    expect(link).toHaveAttribute("href", `/${tenantSlug}/order/${orders[0].orderId}`);
  });

  it("Keluar button logs out and navigates back to the tenant menu", async () => {
    fetchMock.mockResolvedValue({ json: () => Promise.resolve(orders) });
    const navTo = vi.fn();
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
    });
    vi.spyOn(window.location, "href", "set").mockImplementation((v) => navTo(v));

    render(<AccountOrdersList tenantSlug={tenantSlug} />);
    await waitFor(() => expect(screen.getByText("#AAAAAAAA")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keluar"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/customer/logout", { method: "POST" });
      expect(navTo).toHaveBeenCalledWith(`/${tenantSlug}`);
    });
  });
});
