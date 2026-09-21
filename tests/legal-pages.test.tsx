// @vitest-environment jsdom
/**
 * UU PDP — legal pages render (200-equivalent SSR smoke tests).
 * Server components rendered directly (pricing-page.test.tsx pattern):
 *   /[tenantSlug]/privacy, /[tenantSlug]/terms, /privacy, /terms
 * Assert real Indonesian content (not lorem) + cross-links.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TenantPrivacyPage from "@/app/[tenantSlug]/privacy/page";
import TenantTermsPage from "@/app/[tenantSlug]/terms/page";
import PlatformPrivacyPage from "@/app/privacy/page";
import PlatformTermsPage from "@/app/terms/page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const tenantSlug = "kopi-senja";
const params = { params: Promise.resolve({ tenantSlug }) };

describe("legal pages — UU PDP", () => {
  it("/[tenantSlug]/privacy renders real Indonesian content + terms link", async () => {
    render(await TenantPrivacyPage(params));
    expect(
      screen.getByRole("heading", { name: /kebijakan privasi/i, level: 1 })
    ).toBeTruthy();
    // Real content signals — not placeholder (headings are unique; body
    // phrases repeat across sections, so use getAllByText).
    expect(
      screen.getByRole("heading", { name: "1. Data yang Kami Kumpulkan", level: 2 })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "4. Hak Anda atas Data Pribadi", level: 2 })
    ).toBeTruthy();
    expect(screen.getAllByText(/nomor HP/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/riwayat pesanan/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/UU PDP/i).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: /syarat & ketentuan/i })
    ).toHaveAttribute("href", `/${tenantSlug}/terms`);
  });

  it("/[tenantSlug]/terms renders real Indonesian content + privacy link", async () => {
    render(await TenantTermsPage(params));
    expect(
      screen.getByRole("heading", { name: /syarat & ketentuan/i, level: 1 })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "3. Kewajiban Pengguna", level: 2 })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "5. Batasan Tanggung Jawab", level: 2 })
    ).toBeTruthy();
    expect(screen.getAllByText(/kewajiban/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tanggung jawab/i).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: /kebijakan privasi/i })
    ).toHaveAttribute("href", `/${tenantSlug}/privacy`);
  });

  it("/privacy (landing) renders + links to global /terms", async () => {
    render(await PlatformPrivacyPage());
    expect(
      screen.getByRole("heading", { name: /kebijakan privasi/i, level: 1 })
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /syarat & ketentuan/i })
    ).toHaveAttribute("href", "/terms");
  });

  it("/terms (landing) renders + links to global /privacy", async () => {
    render(await PlatformTermsPage());
    expect(
      screen.getByRole("heading", { name: /syarat & ketentuan/i, level: 1 })
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /kebijakan privasi/i })
    ).toHaveAttribute("href", "/privacy");
  });
});
