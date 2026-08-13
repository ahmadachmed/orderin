// @vitest-environment jsdom
/**
 * T28 ITEM 1 (issue #193) — Sidebar rail component tests.
 * Renders the 4 admin nav links (Dasbor/Menu/Riwayat/Pengaturan) with
 * correct tenant-scoped hrefs, highlights the active item, and Keluar
 * calls adminLogout + router.push("/").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Sidebar from "@/components/admin/Sidebar";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/admin/kopi-senja",
}));

const adminLogout = vi.fn();
vi.mock("@/lib/admin-api", () => ({
  adminLogout: () => adminLogout(),
}));

beforeEach(() => {
  adminLogout.mockReset();
  adminLogout.mockResolvedValue(undefined);
  push.mockClear();
});

describe("Sidebar", () => {
  it("renders the 4 admin nav links with correct hrefs", () => {
    render(<Sidebar tenantSlug="kopi-senja" />);

    const expected = [
      ["Dasbor", "/admin/kopi-senja"],
      ["Menu", "/admin/kopi-senja/menu"],
      ["Riwayat", "/admin/kopi-senja/sprints"],
      ["Pengaturan", "/admin/kopi-senja/settings"],
    ] as const;

    for (const [label, href] of expected) {
      const link = screen.getByRole("link", { name: label }) as HTMLAnchorElement;
      expect(link).toBeInTheDocument();
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("D2: does not render the dropped 'Lihat Toko' link", () => {
    render(<Sidebar tenantSlug="kopi-senja" />);
    expect(screen.queryByRole("link", { name: /Lihat Toko/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Lihat Toko/)).not.toBeInTheDocument();
  });

  it("D1: Riwayat (sprints) is reachable as the 5th rail item (4 nav + Keluar)", () => {
    render(<Sidebar tenantSlug="kopi-senja" />);
    const riwayat = screen.getByRole("link", { name: "Riwayat" }) as HTMLAnchorElement;
    expect(riwayat.getAttribute("href")).toBe("/admin/kopi-senja/sprints");
    // Rail = 4 nav links + 1 Keluar button (D1: Riwayat completes the 5-item rail).
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Keluar" })).toBeInTheDocument();
  });

  it("marks the current page as active", () => {
    render(<Sidebar tenantSlug="kopi-senja" />);
    expect(screen.getByRole("link", { name: "Dasbor" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Menu" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("Keluar calls adminLogout and redirects to /", async () => {
    render(<Sidebar tenantSlug="kopi-senja" />);
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }));

    await waitFor(() => {
      expect(adminLogout).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith("/");
    });
  });
});
