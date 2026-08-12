// @vitest-environment jsdom
/**
 * T25 ITEM 1 (issue #164) — OrderLookupForm component tests.
 * Opens from the shop header trigger, validates Indonesian phone format,
 * calls POST /api/order/lookup with {phone, slug}, redirects on 200,
 * and shows inline errors for 404 / 429 / empty / invalid input.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import OrderLookupForm from "@/components/OrderLookupForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const fetchMock = vi.fn();

/** Render + open the dialog, returning the dialog's DOM subtree. */
async function openDialog() {
  render(<OrderLookupForm tenantSlug="kopi-senja" />);
  fireEvent.click(screen.getByRole("button", { name: "Lacak Pesanan" }));
  await screen.findByRole("dialog");
  return within(screen.getByRole("dialog"));
}

beforeEach(() => {
  fetchMock.mockReset();
  push.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OrderLookupForm", () => {
  it("renders the shop-header trigger button", () => {
    render(<OrderLookupForm tenantSlug="kopi-senja" />);
    expect(
      screen.getByRole("button", { name: "Lacak Pesanan" })
    ).toBeInTheDocument();
  });

  it("opens a dialog with phone input + submit button", async () => {
    const dialog = await openDialog();
    expect(dialog.getByLabelText("Nomor HP")).toBeInTheDocument();
    expect(
      dialog.getByRole("button", { name: "Lacak Pesanan" })
    ).toBeInTheDocument();
  });

  it("fires POST /api/order/lookup with {phone, slug} and redirects on 200", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ orderId: "ord_123", status: "BREWING" }),
    });
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Nomor HP"), {
      target: { value: "081234567890" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Lacak Pesanan" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/order/lookup",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: "081234567890", slug: "kopi-senja" }),
        })
      )
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/kopi-senja/order/ord_123")
    );
  });

  it("trims whitespace from the phone before submitting", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ orderId: "ord_9", status: "PENDING" }),
    });
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Nomor HP"), {
      target: { value: "  081234567890  " },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Lacak Pesanan" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/order/lookup",
        expect.objectContaining({
          body: JSON.stringify({ phone: "081234567890", slug: "kopi-senja" }),
        })
      )
    );
  });

  it("shows 'Pesanan tidak ditemukan' on 404", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "No active order found" }),
    });
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Nomor HP"), {
      target: { value: "081234567890" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Lacak Pesanan" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Pesanan tidak ditemukan untuk nomor ini"
      )
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("shows rate-limit message on 429", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "Too many requests" }),
    });
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Nomor HP"), {
      target: { value: "081234567890" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Lacak Pesanan" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Terlalu banyak percobaan, coba lagi nanti"
      )
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("rejects empty input with a validation message and no fetch", async () => {
    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Lacak Pesanan" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Masukkan nomor HP dulu."
      )
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("rejects a non-Indonesian phone format with a validation message", async () => {
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Nomor HP"), {
      target: { value: "12345" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Lacak Pesanan" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Nomor HP tidak valid"
      )
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the error once the user types again", async () => {
    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Lacak Pesanan" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
    fireEvent.change(dialog.getByLabelText("Nomor HP"), {
      target: { value: "08" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
