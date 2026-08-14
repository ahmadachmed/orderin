// @vitest-environment jsdom
/**
 * TEST-02 — OrderStatusTracker component tests (PLAN §10 / issue #24).
 * Renders status badge + ETA + payment options, selects a payment method,
 * and polls on a 5s interval (stopping at terminal statuses).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import OrderStatusTracker from "@/components/OrderStatusTracker";
import { OrderStatusView } from "@/types";

const baseOrder: OrderStatusView = {
  orderId: "11111111-2222-3333-4444-555555555555",
  status: "PENDING",
  etaSeconds: 120,
  queuePosition: null,
  paymentStatus: "UNPAID",
  paymentMethod: null,
  customerTransferNote: null,
  createdAt: "2026-08-04T08:00:00.000Z",
  customerName: "Budi",
  customerPhone: "081234567890",
  items: [
    { name: "Espresso", quantity: 2, unitPrice: 18000, prepTimeSeconds: 90 },
    { name: "Kopi Susu Gula Aren", quantity: 1, unitPrice: 22000, prepTimeSeconds: 150 },
  ],
  total: 58000,
  tenant: {
    name: "Kopi Senja Makassar",
    slug: "kopi-senja",
    qrisCode: "0002010102112665",
    qrisImageUrl: null,
    bankAccountNumber: "1234567890",
    bankName: "BCA",
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OrderStatusTracker", () => {
  it("renders status badge, order number, items and total", () => {
    render(<OrderStatusTracker initial={baseOrder} />);
    // PENDING badge label (OrderStatusBadge)
    expect(screen.getByText("Menunggu konfirmasi")).toBeInTheDocument();
    expect(screen.getByText("#11111111")).toBeInTheDocument();
    // item line renders quantity and name as separate spans
    expect(screen.getByText("2×")).toBeInTheDocument();
    expect(screen.getByText("Espresso")).toBeInTheDocument();
    expect(screen.getByText("Rp 36.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 58.000")).toBeInTheDocument();
    expect(screen.getByText("Atas nama: Budi")).toBeInTheDocument();
  });

  it("shows the ETA while the order is not in a terminal status", () => {
    render(<OrderStatusTracker initial={baseOrder} />);
    // formatDuration(120) → "±2 menit"
    expect(screen.getByText(/Estimasi siap:/)).toBeInTheDocument();
    expect(screen.getByText("±2 menit")).toBeInTheDocument();
  });

  it("renders 'Antrean ke-N' when queuePosition is present (T19)", () => {
    render(<OrderStatusTracker initial={{ ...baseOrder, queuePosition: 2 }} />);
    expect(screen.getByText("Antrean ke-2")).toBeInTheDocument();
    expect(screen.getByText("Posisi antrean")).toBeInTheDocument();
  });

  it("hides the queue position when queuePosition is null (T19)", () => {
    render(<OrderStatusTracker initial={{ ...baseOrder, queuePosition: null }} />);
    expect(screen.queryByText(/Antrean ke-/)).not.toBeInTheDocument();
  });

  it("hides the queue position for terminal statuses even if present (T19)", () => {
    render(
      <OrderStatusTracker
        initial={{ ...baseOrder, status: "READY_FOR_PICKUP", queuePosition: null, etaSeconds: 0 }}
      />
    );
    expect(screen.queryByText(/Antrean ke-/)).not.toBeInTheDocument();
  });

  it("hides the ETA for terminal statuses", () => {
    for (const status of ["PICKED_UP", "CANCELLED"] as const) {
      const { unmount } = render(<OrderStatusTracker initial={{ ...baseOrder, status, etaSeconds: 120 }} />);
      expect(screen.queryByText(/Estimasi siap:/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("hides the ETA when the order is READY_FOR_PICKUP even if etaSeconds is set", () => {
    // STATUS-06 (#151): API sets etaSeconds=0 for READY, formatDuration(0) → "<1 menit",
    // which would render "Estimasi siap: <1 menit dari sekarang" on an order that is already ready.
    render(
      <OrderStatusTracker
        initial={{ ...baseOrder, status: "READY_FOR_PICKUP", etaSeconds: 0, pickupCode: "1234" }}
      />
    );
    expect(screen.queryByText(/Estimasi siap:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/<1 menit/)).not.toBeInTheDocument();
    // pickup code card still shows
    expect(screen.getByText("Kode pengambilan")).toBeInTheDocument();
  });

  it("still shows the ETA for non-terminal, non-ready statuses", () => {
    for (const status of ["PENDING", "CONFIRMED", "BREWING"] as const) {
      const { unmount } = render(<OrderStatusTracker initial={{ ...baseOrder, status, etaSeconds: 120 }} />);
      expect(screen.getByText(/Estimasi siap:/)).toBeInTheDocument();
      expect(screen.getByText("±2 menit")).toBeInTheDocument();
      unmount();
    }
  });

  it("shows QRIS and bank transfer payment options from tenant config", () => {
    render(<OrderStatusTracker initial={baseOrder} />);
    expect(screen.getByRole("button", { name: "QRIS" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transfer Bank" })).toBeInTheDocument();
  });

  it("PATCHes the selected payment method when a payment option is clicked", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<OrderStatusTracker initial={baseOrder} />);

    fireEvent.click(screen.getByRole("button", { name: "QRIS" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/order/11111111-2222-3333-4444-555555555555/payment",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethod: "qris" }),
        })
      );
    });
  });

  it("polls the order endpoint on a 5s interval", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<OrderStatusTracker initial={baseOrder} />);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/order/11111111-2222-3333-4444-555555555555",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("stops polling once the status becomes terminal", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...baseOrder, status: "PICKED_UP" }),
      });
    render(<OrderStatusTracker initial={baseOrder} />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    const callsAfterTerminal = fetchMock.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock.mock.calls.length).toBe(callsAfterTerminal);
  });

  it("shows the paid confirmation when paymentStatus is PAID", () => {
    render(
      <OrderStatusTracker initial={{ ...baseOrder, paymentStatus: "PAID" }} />
    );
    expect(screen.getByText("✓ Pembayaran diterima — terima kasih!")).toBeInTheDocument();
  });

  it("shows the 'Konfirmasi terkirim' message after marking paid with an empty note (issue #210)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(
      <OrderStatusTracker
        initial={{ ...baseOrder, paymentMethod: "bank_transfer" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Saya sudah bayar" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/order/11111111-2222-3333-4444-555555555555/payment",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ paymentMethod: "bank_transfer", customerTransferNote: "" }),
        })
      );
    });

    // Confirmation renders regardless of customerTransferNote being empty,
    // and the button is replaced (no re-submit).
    expect(
      screen.getByText("✓ Konfirmasi terkirim — kasir akan memverifikasi pembayaranmu.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saya sudah bayar" })).not.toBeInTheDocument();
  });

  it("still shows the claim confirmation when a transfer note is present (issue #210)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(
      <OrderStatusTracker
        initial={{ ...baseOrder, paymentMethod: "bank_transfer" }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Catatan transfer/), {
      target: { value: "Budi BCA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Saya sudah bayar" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/order/11111111-2222-3333-4444-555555555555/payment",
        expect.objectContaining({
          body: JSON.stringify({
            paymentMethod: "bank_transfer",
            customerTransferNote: "Budi BCA",
          }),
        })
      );
    });

    expect(
      screen.getByText("✓ Konfirmasi terkirim — kasir akan memverifikasi pembayaranmu.")
    ).toBeInTheDocument();
  });

  it("renders PAID timeline entries with the note as subtitle (STATUS-05)", () => {
    render(
      <OrderStatusTracker
        initial={{
          ...baseOrder,
          statusLogs: [
            {
              id: "log-1",
              status: "PENDING",
              actorType: "system",
              actorName: "customer",
              note: null,
              createdAt: "2026-08-04T08:00:00.000Z",
            },
            {
              id: "log-2",
              status: "PENDING",
              actorType: "admin",
              actorName: "admin",
              note: "Marked PAID via dashboard",
              createdAt: "2026-08-04T08:05:00.000Z",
            },
          ],
        }}
      />
    );
    expect(screen.getByText("Marked PAID via dashboard")).toBeInTheDocument();
  });
});
