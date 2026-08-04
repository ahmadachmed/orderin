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
    price: 18000,
    imageUrl: null,
    prepTimeSeconds: 90,
    sortOrder: 1,
  },
  {
    id: "item-2",
    name: "Kopi Susu Gula Aren",
    description: null,
    price: 22000,
    imageUrl: null,
    prepTimeSeconds: 150,
    sortOrder: 2,
  },
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
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
    expect(screen.getByText("Rp 18.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 22.000")).toBeInTheDocument();
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
});
