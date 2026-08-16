// @vitest-environment jsdom
/**
 * T10 (issue #229) — "Powered by HeadwayBrew" badge render tests.
 * The badge shows on FREE-plan shopfronts and is hidden on PRO, gated by
 * `can(tenant.plan, "showBadge")` from lib/plan.ts (FREE: true, PRO: false).
 *
 * This is the render-path coverage the T10 review (PR #242) flagged as
 * missing: lib/plan.ts unit tests exist (tests/plan.test.ts) but nothing
 * asserted the badge actually appears/disappears on /[tenantSlug] itself.
 * Prisma tenant lookup is mocked per scenario so both plan branches render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ShopMenuPage from "@/app/[tenantSlug]/page";
import { Plan } from "@/lib/plan";
import type { Tenant } from "@/generated/prisma/client";

// Prisma mock — tenant.findUnique returns whichever tenant the test sets.
const prismaMock = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn() },
  menuItem: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

vi.mock("@/lib/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queue")>();
  return { ...actual, fetchQueue: vi.fn().mockResolvedValue([]) };
});

vi.mock("@/lib/customer-auth", () => ({
  getCustomerSession: vi.fn().mockResolvedValue(null),
}));

// Client components are heavy (fetch, localStorage, router); stub them so
// this test focuses on the server-rendered badge.
vi.mock("@/components/QueueIndicator", () => ({ default: () => null }));
vi.mock("@/components/OrderForm", () => ({ default: () => null }));
vi.mock("@/components/ActiveOrderBanner", () => ({ default: () => null }));
vi.mock("@/components/OrderLookupForm", () => ({ default: () => null }));

/** Minimal Tenant row with the fields the shopfront page touches. */
function makeTenant(plan: Plan): Tenant {
  return {
    id: "tnt_1",
    slug: "kopi-senja",
    name: "Kopi Senja",
    address: "Jl. Merdeka No. 1",
    phone: null,
    logoUrl: null,
    isOpen: true,
    isOpenOverrideUntil: null,
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
    plan,
    planExpiresAt: null,
    isActive: true,
    contactEmail: "kedai@kopisenja.id",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

async function renderPage(plan: Plan) {
  prismaMock.tenant.findUnique.mockResolvedValue(makeTenant(plan));
  prismaMock.menuItem.findMany.mockResolvedValue([]);
  return render(
    await ShopMenuPage({ params: Promise.resolve({ tenantSlug: "kopi-senja" }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShopMenuPage — Powered by HeadwayBrew badge (T10)", () => {
  it("shows the badge on a FREE-plan shopfront", async () => {
    await renderPage(Plan.FREE);

    expect(screen.getByText(/Powered by/)).toBeInTheDocument();
    expect(screen.getByText("HeadwayBrew")).toBeInTheDocument();
  });

  it("hides the badge on a PRO-plan shopfront", async () => {
    await renderPage(Plan.PRO);

    expect(screen.queryByText(/Powered by/)).not.toBeInTheDocument();
    expect(screen.queryByText("HeadwayBrew")).not.toBeInTheDocument();
  });
});
