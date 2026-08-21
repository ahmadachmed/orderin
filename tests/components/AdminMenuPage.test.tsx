// @vitest-environment jsdom
/**
 * Monetisation Phase 3 (issue #257) — admin menu page upgrade-path link.
 *
 * PR #260 review fix (@senior REJECT, pullrequestreview-4981387408):
 * AC1 admin side — menu/page.tsx must render "Lihat paket PRO" → /pricing
 * when the 402 menu-cap error carries an upgradeUrl, mirroring OrderForm.
 *
 * Covers: fetchMenu() rejecting with {message, upgradeUrl} renders the
 * message + a clickable link with the API-provided href; a plain error
 * renders the message WITHOUT the link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AdminMenuPage from "@/app/admin/[tenantSlug]/menu/page";
import { fetchMenu } from "@/lib/admin-api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenantSlug: "kopi-senja" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/admin-api", () => ({
  fetchMenu: vi.fn(),
  createMenuItem: vi.fn(),
  updateMenuItem: vi.fn(),
  deleteMenuItem: vi.fn(),
}));

const mockFetchMenu = vi.mocked(fetchMenu);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchMenu.mockResolvedValue([]);
});

describe("AdminMenuPage — upgrade path (PR #260 fix)", () => {
  it("renders 'Lihat paket PRO' link when fetchMenu error carries upgradeUrl", async () => {
    const err = new Error("Menu item limit reached (25). Upgrade to PRO for unlimited menu items.");
    (err as Error & { upgradeUrl?: string }).upgradeUrl = "/pricing?utm=limit";
    mockFetchMenu.mockRejectedValue(err);

    render(<AdminMenuPage />);

    await waitFor(() => {
      expect(screen.getByText(/Menu item limit reached \(25\)/)).toBeInTheDocument();
    });
    const link = screen.getByRole("link", { name: "Lihat paket PRO" });
    expect(link).toHaveAttribute("href", "/pricing?utm=limit");
  });

  it("renders plain message without upgrade link when error has no upgradeUrl", async () => {
    mockFetchMenu.mockRejectedValue(new Error("Gagal memuat menu"));

    render(<AdminMenuPage />);

    await waitFor(() => {
      expect(screen.getByText("Gagal memuat menu")).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "Lihat paket PRO" })).not.toBeInTheDocument();
  });
});
