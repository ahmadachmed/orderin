// @vitest-environment jsdom
/**
 * Issue #215 — ActiveOrderBanner tests.
 * The banner must pick the NEWEST non-terminal order for the tenant:
 *   - old terminal order + new active order -> banner shows the new order
 *   - only terminal orders -> banner hidden
 *   - only an active order -> banner shows (regression, #210/#211)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ActiveOrderBanner from "@/components/ActiveOrderBanner";

const STORAGE_KEY = "headwaybrew_orders";

interface OrderEntry {
  orderId: string;
  slug: string;
  customerName: string;
  createdAt: number;
}

function seedRegistry(orders: OrderEntry[]) {
  const registry: Record<string, OrderEntry> = {};
  for (const o of orders) registry[o.orderId] = o;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
}

function mockStatusFetch(statusByOrderId: Record<string, string | null>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const id = String(url).split("/").pop();
    const status = statusByOrderId[id ?? ""];
    return {
      ok: status !== undefined && status !== null,
      json: async () => (status ? { status } : {}),
    } as Response;
  });
}

const OLD_TERMINAL: OrderEntry = {
  orderId: "11111111-1111-1111-1111-111111111111",
  slug: "kopi-senja",
  customerName: "Budi",
  createdAt: 1000,
};

const NEW_ACTIVE: OrderEntry = {
  orderId: "22222222-2222-2222-2222-222222222222",
  slug: "kopi-senja",
  customerName: "Andi",
  createdAt: 2000,
};

const OTHER_TENANT: OrderEntry = {
  orderId: "33333333-3333-3333-3333-333333333333",
  slug: "kopi-lain",
  customerName: "Cici",
  createdAt: 3000,
};

describe("ActiveOrderBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows the newest active order when an older order is terminal (#215)", async () => {
    seedRegistry([OLD_TERMINAL, NEW_ACTIVE]);
    const fetchMock = mockStatusFetch({
      [OLD_TERMINAL.orderId]: "PICKED_UP",
      [NEW_ACTIVE.orderId]: "BREWING",
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ActiveOrderBanner tenantSlug="kopi-senja" />);

    const banner = await screen.findByRole("link", {
      name: /Lanjutkan pesanan Andi/,
    });
    expect(banner).toHaveAttribute(
      "href",
      `/kopi-senja/order/${NEW_ACTIVE.orderId}`,
    );
    // newest candidate checked first; the terminal one is skipped
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/order/${NEW_ACTIVE.orderId}`),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("renders nothing when every order for the tenant is terminal (#215)", async () => {
    seedRegistry([OLD_TERMINAL, { ...NEW_ACTIVE, customerName: "Andi" }]);
    vi.stubGlobal(
      "fetch",
      mockStatusFetch({
        [OLD_TERMINAL.orderId]: "CANCELLED",
        [NEW_ACTIVE.orderId]: "PICKED_UP",
      }),
    );

    render(<ActiveOrderBanner tenantSlug="kopi-senja" />);

    await vi.waitFor(() => {
      expect(screen.queryByRole("link", { name: /Lanjutkan pesanan/ })).not.toBeInTheDocument();
    });
  });

  it("still shows the banner when only an active order exists (regression #210/#211)", async () => {
    seedRegistry([NEW_ACTIVE, OTHER_TENANT]);
    vi.stubGlobal(
      "fetch",
      mockStatusFetch({ [NEW_ACTIVE.orderId]: "CONFIRMED" }),
    );

    render(<ActiveOrderBanner tenantSlug="kopi-senja" />);

    const banner = await screen.findByRole("link", {
      name: /Lanjutkan pesanan Andi/,
    });
    expect(banner).toHaveAttribute(
      "href",
      `/kopi-senja/order/${NEW_ACTIVE.orderId}`,
    );
  });

  it("sorts candidates by createdAt desc even when the registry order is oldest-first", async () => {
    // registry insertion order: new first, old second — sort must still pick
    // the newest, and only fall back to the older one if the newest is terminal
    seedRegistry([NEW_ACTIVE, OLD_TERMINAL]);
    vi.stubGlobal(
      "fetch",
      mockStatusFetch({
        [NEW_ACTIVE.orderId]: "PICKED_UP",
        [OLD_TERMINAL.orderId]: "BREWING",
      }),
    );

    render(<ActiveOrderBanner tenantSlug="kopi-senja" />);

    const banner = await screen.findByRole("link", {
      name: /Lanjutkan pesanan Budi/,
    });
    expect(banner).toHaveAttribute(
      "href",
      `/kopi-senja/order/${OLD_TERMINAL.orderId}`,
    );
  });
});
