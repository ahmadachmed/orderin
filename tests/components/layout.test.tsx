// @vitest-environment jsdom
/**
 * T28 ITEM 1 (issue #193) — shared admin layout tests.
 * Renders the Sidebar rail (tenant-scoped) plus page children inside <main>,
 * and the shared top header (shop name + Buka/Tutup toggle, ITEM 3 / #196).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "@/app/admin/[tenantSlug]/layout";
import { usePathname } from "next/navigation";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenantSlug: "kopi-senja" }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: vi.fn(() => "/admin/kopi-senja"),
}));

vi.mock("@/lib/admin-api", () => ({
  adminLogout: vi.fn(),
  fetchSettings: vi.fn().mockResolvedValue({
    id: "tnt_1",
    slug: "kopi-senja",
    name: "Kopi Senja",
    isOpen: true,
    openTime: "07:00",
    closeTime: "21:00",
    timezone: "Asia/Makassar",
    maxQueueSize: 20,
    prepTimeBuffer: 0,
    sprintDurationDays: 1,
    qrisImageUrl: null,
    qrisCode: null,
    bankAccountNumber: null,
    bankName: null,
  }),
  updateSettings: vi.fn(),
}));

describe("AdminLayout", () => {
  it("renders the sidebar and page children", async () => {
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

  it("renders the shared header with the Buka/Tutup toggle and shop name", async () => {
    render(
      <AdminLayout>
        <p>Konten halaman</p>
      </AdminLayout>
    );

    expect(await screen.findByText("Kopi Senja")).toBeVisible();
    expect(screen.getByRole("button", { name: "Buka Toko" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Tutup Toko" })).toBeVisible();
  });

  it("renders login standalone without sidebar or ml-64 offset", () => {
    vi.mocked(usePathname).mockReturnValue("/admin/kopi-senja/login");

    render(
      <AdminLayout>
        <p>Form login</p>
      </AdminLayout>
    );

    expect(screen.queryByRole("link", { name: "Dasbor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keluar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buka Toko" })).not.toBeInTheDocument();
    expect(screen.getByText("Form login")).toBeVisible();
    expect(document.querySelector("main.ml-64")).toBeNull();
  });
});
