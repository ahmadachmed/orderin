// @vitest-environment jsdom
/**
 * T20 ACCT-03 (docs/T18-plan.md GAP 2) — /[tenantSlug]/login reads the
 * ?next= search param and pushes there after a successful login; falls back
 * to account/orders when next is absent or invalid (open-redirect guard).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomerLoginPage from "@/app/[tenantSlug]/login/page";

const tenantSlug = "kopi-senja";
const fetchMock = vi.fn();

const { navMock, searchParamsMock } = vi.hoisted(() => ({
  navMock: { push: vi.fn(), refresh: vi.fn() },
  searchParamsMock: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenantSlug }),
  useRouter: () => navMock,
  useSearchParams: () => searchParamsMock.current,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

beforeEach(() => {
  fetchMock.mockReset();
  navMock.push.mockReset();
  navMock.refresh.mockReset();
  searchParamsMock.current = new URLSearchParams();
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submitLogin() {
  render(<CustomerLoginPage />);
  fireEvent.change(screen.getByPlaceholderText("Nomor HP (mis. 0812xxxx)"), {
    target: { value: "0812-3456" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: "secret123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Masuk" }));
  await waitFor(() => expect(navMock.push).toHaveBeenCalled());
}

describe("CustomerLoginPage (T20 ACCT-03)", () => {
  it("pushes to account/orders by default when no next param is present", async () => {
    await submitLogin();
    expect(navMock.push).toHaveBeenCalledWith(`/${tenantSlug}/account/orders`);
    expect(navMock.refresh).toHaveBeenCalled();
  });

  it("pushes to the ?next= target after login when present", async () => {
    searchParamsMock.current = new URLSearchParams({ next: "account/orders" });
    await submitLogin();
    expect(navMock.push).toHaveBeenCalledWith(`/${tenantSlug}/account/orders`);
  });

  it("pushes to a custom relative next target", async () => {
    searchParamsMock.current = new URLSearchParams({ next: "order/abc-123" });
    await submitLogin();
    expect(navMock.push).toHaveBeenCalledWith(`/${tenantSlug}/order/abc-123`);
  });

  it("falls back to account/orders for an open-redirect attempt", async () => {
    searchParamsMock.current = new URLSearchParams({ next: "//evil.com" });
    await submitLogin();
    expect(navMock.push).toHaveBeenCalledWith(`/${tenantSlug}/account/orders`);
  });

  it("falls back to account/orders for a path-traversal attempt", async () => {
    searchParamsMock.current = new URLSearchParams({ next: "../admin" });
    await submitLogin();
    expect(navMock.push).toHaveBeenCalledWith(`/${tenantSlug}/account/orders`);
  });

  it("sends the login payload with slug and credentials", async () => {
    await submitLogin();
    expect(fetchMock).toHaveBeenCalledWith("/api/customer/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: tenantSlug, phone: "0812-3456", password: "secret123" }),
    });
  });
});
