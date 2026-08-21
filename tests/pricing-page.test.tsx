// @vitest-environment jsdom
/**
 * Monetisation Phase 3 / T20 — /pricing page component tests (issue #257).
 * Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §8.1 / §10.
 *
 * Server component rendered directly: mocks next/headers (session), @/lib/db
 * (tenant slug lookup) and next/link. Covers the Rp99.000 price, PRO benefit
 * list, and CTA routing: no session → /login; admin session → the tenant's
 * settings billing section.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { default as PricingPage } from "@/app/pricing/page";
import { createSession } from "../src/lib/auth";

const { sessionStore } = vi.hoisted(() => ({
  sessionStore: { token: null as string | null },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "headwaybrew_admin_session" && sessionStore.token
        ? { value: sessionStore.token }
        : undefined,
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ slug: "kopi-senja" }),
    },
  },
}));

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

describe("/pricing", () => {
  it("renders the Rp99.000 monthly price", async () => {
    sessionStore.token = null;
    render(await PricingPage());
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/99\.000/);
    expect(heading).toHaveTextContent(/bulan/);
  });

  it("lists the PRO benefits", async () => {
    sessionStore.token = null;
    render(await PricingPage());
    const benefits = screen.getByTestId("pro-benefits");
    expect(benefits).toHaveTextContent("Menu tanpa batas");
    expect(benefits).toHaveTextContent("Order tanpa batas");
    expect(benefits).toHaveTextContent("Antrean hingga 100 order");
    expect(benefits).toHaveTextContent("Retensi sprint 30 hari");
    expect(benefits).toHaveTextContent("Tanpa badge");
    expect(benefits).toHaveTextContent("Prioritas support");
  });

  it("CTA routes to /login when there is no admin session", async () => {
    sessionStore.token = null;
    render(await PricingPage());
    expect(screen.getByTestId("pricing-cta")).toHaveAttribute("href", "/login");
  });

  it("CTA routes to the tenant's billing settings when an admin session exists", async () => {
    sessionStore.token = createSession("tnt_1", "admin_1");
    render(await PricingPage());
    const cta = screen.getByTestId("pricing-cta");
    expect(cta).toHaveAttribute("href", "/admin/kopi-senja/settings?billing=1");
  });

  it("labels the CTA 'Bayar sekarang'", async () => {
    sessionStore.token = null;
    render(await PricingPage());
    expect(screen.getByTestId("pricing-cta")).toHaveTextContent("Bayar sekarang");
  });

  it("shows payment methods without naming the gateway", async () => {
    sessionStore.token = null;
    render(await PricingPage());
    expect(screen.getAllByText(/QRIS atau transfer bank/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/duitku/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/xendit/i)).not.toBeInTheDocument();
  });

  it("renders the FREE vs PRO comparison", async () => {
    sessionStore.token = null;
    render(await PricingPage());
    const comparison = screen.getByTestId("plan-comparison");
    expect(comparison).toHaveTextContent("FREE");
    expect(comparison).toHaveTextContent("PRO");
    expect(comparison).toHaveTextContent("25 item menu");
  });

  it("renders the FAQ", async () => {
    sessionStore.token = null;
    render(await PricingPage());
    const faq = screen.getByTestId("pricing-faq");
    expect(faq).toHaveTextContent("Apakah bisa coba gratis?");
    expect(faq).toHaveTextContent("Bagaimana cara bayar?");
    expect(faq).toHaveTextContent("Bisa berhenti kapan saja?");
  });
});
