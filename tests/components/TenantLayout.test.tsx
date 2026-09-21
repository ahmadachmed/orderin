// @vitest-environment jsdom
/**
 * UU PDP — customer shopfront footer (tenant layout).
 * The legal links must be reachable from every customer-facing shop page, so
 * they live on the [tenantSlug] layout rather than one page.
 * Rendered as an async server component with awaited params.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TenantLayout from "@/app/[tenantSlug]/layout";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const tenantSlug = "kopi-senja";

async function renderLayout() {
  render(
    await TenantLayout({
      children: <p>Konten kedai</p>,
      params: Promise.resolve({ tenantSlug }),
    })
  );
}

describe("TenantLayout — legal footer (UU PDP)", () => {
  it("renders the children inside the shop shell", async () => {
    await renderLayout();
    expect(screen.getByText("Konten kedai")).toBeTruthy();
  });

  it("links to the tenant-scoped privacy and terms pages", async () => {
    await renderLayout();
    expect(
      screen.getByRole("link", { name: /kebijakan privasi/i })
    ).toHaveAttribute("href", `/${tenantSlug}/privacy`);
    expect(
      screen.getByRole("link", { name: /syarat & ketentuan/i })
    ).toHaveAttribute("href", `/${tenantSlug}/terms`);
  });
});
