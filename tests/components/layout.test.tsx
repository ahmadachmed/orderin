// @vitest-environment jsdom
/**
 * T28 ITEM 1 (issue #193) — shared admin layout tests.
 * Renders the Sidebar rail (tenant-scoped) plus page children inside <main>.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "@/app/admin/[tenantSlug]/layout";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenantSlug: "kopi-senja" }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/kopi-senja",
}));

vi.mock("@/lib/admin-api", () => ({
  adminLogout: vi.fn(),
}));

describe("AdminLayout", () => {
  it("renders the sidebar and page children", () => {
    render(
      <AdminLayout>
        <p>Konten halaman</p>
      </AdminLayout>
    );

    expect(screen.getByRole("link", { name: "Dasbor" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Menu" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Riwayat" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Pengaturan" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Keluar" })).toBeVisible();
    expect(screen.getByText("Konten halaman")).toBeVisible();
  });
});
