// @vitest-environment jsdom
/**
 * TEST-02 — OrderForm component tests (PLAN §10 / issue #24).
 * Renders menu items, quantity steppers, disabled submit on empty cart,
 * fetch payload + redirect on success, error message on API failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import OrderForm from "@/components/OrderForm";
import { MenuItemView } from "@/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const items: MenuItemView[] = [
  {
    id: "item-1",
    name: "Espresso",
    description: "Single-origin espresso shot",
    category: "Minuman",
    price: 18000,
    imageUrl: null,
    prepTimeSeconds: 90,
    sortOrder: 1,
  },
  {
    id: "item-2",
    name: "Kopi Susu Gula Aren",
    description: null,
    category: "Minuman",
    price: 22000,
    imageUrl: null,
    prepTimeSeconds: 150,
    sortOrder: 2,
  },
  {
    id: "item-3",
    name: "Pisang Goreng",
    description: null,
    category: "Camilan",
    price: 15000,
    imageUrl: null,
    prepTimeSeconds: 300,
    sortOrder: 3,
  },
  {
    id: "item-4",
    name: "Teh Tawar",
    description: null,
    price: 8000,
    imageUrl: null,
    prepTimeSeconds: 60,
    sortOrder: 4,
  },
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // T17-6: OrderForm probes /api/customer/me on mount — default to a
  // not-logged-in response so plain renders don't hit an undefined return.
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ loggedIn: false }),
  });
  push.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OrderForm", () => {
  it("renders all menu items with prices", () => {
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);
    expect(screen.getByText("Espresso")).toBeInTheDocument();
    expect(screen.getByText("Kopi Susu Gula Aren")).toBeInTheDocument();
    expect(screen.getByText("Pisang Goreng")).toBeInTheDocument();
    expect(screen.getByText("Teh Tawar")).toBeInTheDocument();
    expect(screen.getByText("Rp 18.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 22.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 15.000")).toBeInTheDocument();
  });

  it("renders category tabs derived from the menu (Semua + unique categories)", () => {
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);
    expect(screen.getByRole("button", { name: "Semua" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minuman" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camilan" })).toBeInTheDocument();
    // No category tab for unset categories — those items only appear under "Semua".
    expect(screen.queryByRole("button", { name: "Teh Tawar" })).not.toBeInTheDocument();
  });

  it("filters the menu when a category tab is selected", () => {
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Minuman" }));
    expect(screen.getByText("Espresso")).toBeInTheDocument();
    expect(screen.getByText("Kopi Susu Gula Aren")).toBeInTheDocument();
    expect(screen.queryByText("Pisang Goreng")).not.toBeInTheDocument();
    expect(screen.queryByText("Teh Tawar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Semua" }));
    expect(screen.getByText("Pisang Goreng")).toBeInTheDocument();
    expect(screen.getByText("Teh Tawar")).toBeInTheDocument();
  });

  it("increments and decrements quantity with +/− buttons", () => {
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);
    const itemRow = screen.getByText("Espresso").closest("li")!;

    fireEvent.click(within(itemRow).getByRole("button", { name: "Tambah Espresso" }));
    fireEvent.click(within(itemRow).getByRole("button", { name: "Tambah Espresso" }));
    expect(within(itemRow).getByText("2")).toBeInTheDocument();

    fireEvent.click(within(itemRow).getByRole("button", { name: "Kurangi Espresso" }));
    expect(within(itemRow).getByText("1")).toBeInTheDocument();
  });

  it("keeps submit disabled while the cart is empty", () => {
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);
    const submit = screen.getByRole("button", { name: "Buat Pesanan" });
    expect(submit).toBeDisabled();
  });

  it("submits cart via POST /api/order and redirects to the status page", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: "order-123" }),
    });
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Tambah Espresso" }));
    fireEvent.change(screen.getByPlaceholderText("Nama"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByPlaceholderText("Nomor HP (mis. 0812xxxx)"), {
      target: { value: "081234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buat Pesanan" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/order",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: "kopi-senja",
            customerName: "Budi",
            customerPhone: "081234567890",
            items: [{ menuItemId: "item-1", quantity: 1 }],
          }),
        })
      );
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/kopi-senja/order/order-123"));
  });

  it("keeps the submit button processing until the redirect navigation lands (issue #217)", async () => {
    // Real router.push is async: the RSC navigation can take seconds on a
    // cold serverless function. The button must NOT flip back to "Buat
    // Pesanan" while the redirect is still in flight — that reset made the
    // customer think the order failed and they stayed on the menu page.
    let resolvePush!: () => void;
    push.mockImplementationOnce(
      () => new Promise<void>((res) => { resolvePush = res; })
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: "order-123" }),
    });
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Tambah Espresso" }));
    fireEvent.change(screen.getByPlaceholderText("Nama"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByPlaceholderText("Nomor HP (mis. 0812xxxx)"), {
      target: { value: "081234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buat Pesanan" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/kopi-senja/order/order-123"));
    // Navigation still in flight — button stays "Memproses..." (disabled).
    expect(screen.getByRole("button", { name: "Memproses..." })).toBeDisabled();
    resolvePush();
  });

  it("hard-navigates to the status page when router.push fails (issue #217)", async () => {
    // When the client-side (RSC) navigation rejects — e.g. the status page's
    // serverless function times out on a cold start — the customer must still
    // reach /order/[orderId] via a full browser navigation instead of being
    // silently stranded on the menu page with the order already created.
    // jsdom's location.assign is non-configurable, so swap the whole
    // location object for one with a spyable assign.
    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { assign } as unknown as Location,
    });
    push.mockRejectedValueOnce(new Error("RSC navigation failed"));
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: "order-123" }),
    });
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Tambah Espresso" }));
    fireEvent.change(screen.getByPlaceholderText("Nama"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByPlaceholderText("Nomor HP (mis. 0812xxxx)"), {
      target: { value: "081234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buat Pesanan" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/kopi-senja/order/order-123"));
    expect(push).toHaveBeenCalledWith("/kopi-senja/order/order-123");
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("shows the API error message when the order request fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Antrean penuh, coba lagi nanti." }),
    });
    render(<OrderForm tenantSlug="kopi-senja" items={items} isOpen={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Tambah Espresso" }));
    fireEvent.change(screen.getByPlaceholderText("Nama"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByPlaceholderText("Nomor HP (mis. 0812xxxx)"), {
      target: { value: "081234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buat Pesanan" }));

    expect(await screen.findByText("Antrean penuh, coba lagi nanti.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the closed message and hides the order form when the shop is closed", () => {
    render(
      <OrderForm
        tenantSlug="kopi-senja"
        items={items}
        isOpen={false}
        closedMessage="Kedai tutup — buka kembali pukul 08:00."
      />
    );
    expect(screen.getByText("Kedai tutup — buka kembali pukul 08:00.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buat Pesanan" })).not.toBeInTheDocument();
  });

  it("disables quantity controls when the shop is closed", () => {
    render(
      <OrderForm tenantSlug="kopi-senja" items={items} isOpen={false} closedMessage="Kedai tutup." />
    );
    expect(screen.getByRole("button", { name: "Tambah Espresso" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tambah Kopi Susu Gula Aren" })).toBeDisabled();
  });

  it("cannot build a cart while the shop is closed (no dead-end cart)", () => {
    render(
      <OrderForm tenantSlug="kopi-senja" items={items} isOpen={false} closedMessage="Kedai tutup." />
    );
    fireEvent.click(screen.getByRole("button", { name: "Tambah Espresso" }));
    // Closed message stays, no stepper (Kurangi) appears, no submit path.
    expect(screen.getByText("Kedai tutup.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kurangi Espresso" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buat Pesanan" })).not.toBeInTheDocument();
  });
});
