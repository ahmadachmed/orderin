// @vitest-environment jsdom
/**
 * UU PDP — customer register form consent checkbox (docs/PLAN.md).
 * - Checkbox "Saya setuju dengan Kebijakan Privasi & Syarat Ketentuan"
 *   default unchecked, submit disabled until checked.
 * - Links to /[tenantSlug]/privacy and /[tenantSlug]/terms.
 * - Submit payload includes consent: true.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomerRegisterPage from "@/app/[tenantSlug]/register/page";

const tenantSlug = "kopi-senja";
const fetchMock = vi.fn();

const { navMock } = vi.hoisted(() => ({
  navMock: { push: vi.fn(), refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenantSlug }),
  useRouter: () => navMock,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function fillForm() {
  fireEvent.change(screen.getByPlaceholderText("Nama"), {
    target: { value: "Budi Santoso" },
  });
  fireEvent.change(screen.getByPlaceholderText("Nomor HP (mis. 0812xxxx)"), {
    target: { value: "0812-3456" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password (min 6 karakter)"), {
    target: { value: "secret123" },
  });
  fireEvent.change(screen.getByPlaceholderText("Konfirmasi password"), {
    target: { value: "secret123" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  navMock.push.mockReset();
  navMock.refresh.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ok: true }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CustomerRegisterPage — consent checkbox (UU PDP)", () => {
  it("renders the consent checkbox unchecked and links to privacy/terms", () => {
    render(<CustomerRegisterPage />);
    const checkbox = screen.getByRole("checkbox", {
      name: /saya setuju dengan kebijakan privasi & syarat/i,
    });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole("link", { name: /kebijakan privasi/i })).toHaveAttribute(
      "href",
      `/${tenantSlug}/privacy`
    );
    expect(
      screen.getByRole("link", { name: /syarat & ketentuan/i })
    ).toHaveAttribute("href", `/${tenantSlug}/terms`);
  });

  it("keeps the submit button disabled until the checkbox is checked", () => {
    render(<CustomerRegisterPage />);
    const submit = screen.getByRole("button", { name: "Daftar" });
    expect(submit).toBeDisabled();

    const checkbox = screen.getByRole("checkbox", {
      name: /saya setuju dengan kebijakan privasi & syarat/i,
    });
    fireEvent.click(checkbox);
    expect(submit).toBeEnabled();
  });

  it("does not submit when the checkbox is unchecked", async () => {
    render(<CustomerRegisterPage />);
    fillForm();
    const submit = screen.getByRole("button", { name: "Daftar" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits with consent: true when the checkbox is checked", async () => {
    render(<CustomerRegisterPage />);
    fillForm();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /saya setuju dengan kebijakan privasi & syarat/i,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Daftar" }));
    await waitFor(() => expect(navMock.push).toHaveBeenCalled());

    expect(fetchMock).toHaveBeenCalledWith("/api/customer/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: tenantSlug,
        name: "Budi Santoso",
        phone: "0812-3456",
        password: "secret123",
        consent: true,
      }),
    });
  });
});
