// @vitest-environment jsdom
/**
 * T29-2 (issue #247) — Kedai Paling Populer.
 * Unit tests for the server-side query helper `getPopularShops` (mock prisma:
 * 30-day window, CANCELLED excluded, desc by count, take 3, tenant join) and
 * the PopularShops component render (rank #1 besar + label "Paling Diminati",
 * badges via effectiveOpen, empty state D4: <3 show as-is, 0 → section hidden).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PopularShops, {
  getPopularShops,
  type PopularShop,
} from "@/components/landing/PopularShops";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = new Date("2026-08-16T12:00:00.000Z");

function mockPrisma() {
  const orderGroupBy = vi.fn();
  const tenantFindMany = vi.fn();
  const prisma = {
    order: { groupBy: orderGroupBy },
    tenant: { findMany: tenantFindMany },
  };
  return { prisma, orderGroupBy, tenantFindMany };
}

function shop(overrides: Partial<PopularShop> = {}): PopularShop {
  return {
    slug: "kopi-senja",
    name: "Kopi Senja",
    address: "Jl. Senja No. 1",
    isOpen: true,
    openTime: "07:00",
    closeTime: "21:00",
    timezone: "Asia/Makassar",
    isOpenOverrideUntil: null,
    orderCount: 42,
    ...overrides,
  };
}

describe("getPopularShops — query helper (mock prisma)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("groupBy tenantId with 30-day window, CANCELLED excluded, desc, take 3", async () => {
    const { prisma, orderGroupBy, tenantFindMany } = mockPrisma();
    orderGroupBy.mockResolvedValue([
      { tenantId: "t1", _count: { _all: 12 } },
      { tenantId: "t2", _count: { _all: 9 } },
      { tenantId: "t3", _count: { _all: 4 } },
    ]);
    tenantFindMany.mockResolvedValue([
      { id: "t1", slug: "kopi-senja", name: "Kopi Senja", address: "Jl. Senja", isOpen: true, openTime: "07:00", closeTime: "21:00", timezone: "Asia/Makassar", isOpenOverrideUntil: null },
      { id: "t2", slug: "kopi-hitam", name: "Kopi Hitam", address: null, isOpen: false, openTime: "08:00", closeTime: "17:00", timezone: "Asia/Makassar", isOpenOverrideUntil: null },
      { id: "t3", slug: "warung-teh", name: "Warung Teh", address: "Pasar Baru", isOpen: true, openTime: "10:00", closeTime: "22:00", timezone: "Asia/Makassar", isOpenOverrideUntil: null },
    ]);

    const result = await getPopularShops(prisma as never, NOW);

    expect(orderGroupBy).toHaveBeenCalledTimes(1);
    const args = orderGroupBy.mock.calls[0][0];
    expect(args.by).toEqual(["tenantId"]);
    expect(args.where.createdAt.gte).toEqual(
      new Date("2026-07-17T12:00:00.000Z"),
    );
    expect(args.where.status).toEqual({ not: "CANCELLED" });
    expect(args.orderBy).toEqual({ _count: { tenantId: "desc" } });
    expect(args.take).toBe(3);

    expect(tenantFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2", "t3"] } },
      select: expect.objectContaining({
        slug: true,
        name: true,
        address: true,
        isOpen: true,
        openTime: true,
        closeTime: true,
        timezone: true,
        isOpenOverrideUntil: true,
      }),
    });

    // join preserves groupBy rank order + attaches orderCount
    expect(result.map((s) => s.slug)).toEqual([
      "kopi-senja",
      "kopi-hitam",
      "warung-teh",
    ]);
    expect(result[0].orderCount).toBe(12);
    expect(result[2].orderCount).toBe(4);
  });

  it("returns [] without tenant lookup when zero orders", async () => {
    const { prisma, orderGroupBy, tenantFindMany } = mockPrisma();
    orderGroupBy.mockResolvedValue([]);

    const result = await getPopularShops(prisma as never, NOW);

    expect(result).toEqual([]);
    expect(tenantFindMany).not.toHaveBeenCalled();
  });

  it("drops groups whose tenant no longer exists", async () => {
    const { prisma, orderGroupBy, tenantFindMany } = mockPrisma();
    orderGroupBy.mockResolvedValue([
      { tenantId: "t1", _count: { _all: 5 } },
      { tenantId: "ghost", _count: { _all: 3 } },
    ]);
    tenantFindMany.mockResolvedValue([
      { id: "t1", slug: "kopi-senja", name: "Kopi Senja", address: null, isOpen: true, openTime: "07:00", closeTime: "21:00", timezone: "Asia/Makassar", isOpenOverrideUntil: null },
    ]);

    const result = await getPopularShops(prisma as never, NOW);

    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("kopi-senja");
  });
});

describe("PopularShops — render", () => {
  it("rank #1 big with label Paling Diminati; #2/#3 regular; badges via effectiveOpen; cards link to /[slug]", () => {
    render(
      <PopularShops
        shops={[
          shop({
            slug: "kopi-senja",
            name: "Kopi Senja",
            orderCount: 42,
            // schedule 07:00-21:00 UTC, NOW=12:00Z → open
            openTime: "07:00",
            closeTime: "21:00",
          }),
          shop({
            slug: "kopi-hitam",
            name: "Kopi Hitam",
            address: null,
            orderCount: 19,
            // schedule 08:00-17:00 UTC but admin override force-closed
            isOpen: false,
            isOpenOverrideUntil: new Date("2026-08-20T00:00:00.000Z"),
          }),
          shop({
            slug: "warung-teh",
            name: "Warung Teh",
            orderCount: 7,
            openTime: "23:00",
            closeTime: "02:00",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Kedai Paling Populer")).toBeInTheDocument();
    expect(screen.getByText("Paling Diminati")).toBeInTheDocument();

    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/kopi-senja",
      "/kopi-hitam",
      "/warung-teh",
    ]);

    // effectiveOpen: senja buka (schedule), hitam tutup (override), teh tutup
    // (23:00-02:00 UTC di luar 12:00Z — buka tengah malam, tutup subuh)
    expect(screen.getAllByText("Buka")).toHaveLength(1);
    expect(screen.getAllByText("Tutup")).toHaveLength(2);

    expect(screen.getByText("42 pesanan")).toBeInTheDocument();
    expect(screen.getByText("19 pesanan")).toBeInTheDocument();
  });

  it("< 3 shops → shows as-is (D4), ranks continue from #2", () => {
    render(
      <PopularShops
        shops={[
          shop({ slug: "kopi-senja", name: "Kopi Senja", orderCount: 9 }),
        ]}
      />,
    );

    expect(screen.getByText("Kedai Paling Populer")).toBeInTheDocument();
    expect(screen.getByText("Paling Diminati")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("0 shops → section hidden (D4)", () => {
    const { container } = render(<PopularShops shops={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Kedai Paling Populer")).not.toBeInTheDocument();
  });
});
