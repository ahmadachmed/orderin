// @vitest-environment jsdom
/**
 * Issue #134 — ShopSearchForm component tests.
 * Renders the landing search card, normalizes the typed shop name, validates
 * with the SLUG_RE contract, redirects on success and shows an inline error
 * (text-destructive) instead of navigating on invalid input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ShopSearchForm, { normalizeSlug } from "@/components/ShopSearchForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

beforeEach(() => {
  push.mockClear();
});

describe("normalizeSlug", () => {
  it("lowercases and trims", () => {
    expect(normalizeSlug("  Kopi Senja  ")).toBe("kopi-senja");
  });

  it("maps spaces to dashes", () => {
    expect(normalizeSlug("kopi susu gula aren")).toBe("kopi-susu-gula-aren");
  });

  it("strips characters outside [a-z0-9-]", () => {
    expect(normalizeSlug("Kopi Senja!?")).toBe("kopi-senja");
    expect(normalizeSlug("kopi.senja")).toBe("kopisenja");
    expect(normalizeSlug("es teh")).toBe("es-teh");
  });
});

describe("ShopSearchForm", () => {
  it("renders the label contract, #shop-search input and Lanjut button", () => {
    render(<ShopSearchForm />);
    expect(screen.getByLabelText("Masukkan Nama Kedai")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("kopi-senja")).toHaveAttribute("id", "shop-search");
    expect(screen.getByRole("button", { name: /Lanjut/ })).toBeInTheDocument();
  });

  it("redirects to /[slug] on submit with a valid slug", () => {
    render(<ShopSearchForm />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi-senja" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).toHaveBeenCalledWith("/kopi-senja");
  });

  it("normalizes the typed value before redirecting", () => {
    render(<ShopSearchForm />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "Kopi Senja!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).toHaveBeenCalledWith("/kopi-senja");
  });

  it("shows an inline error instead of redirecting on empty input", () => {
    render(<ShopSearchForm />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveClass("text-destructive");
  });

  it("shows an inline error instead of redirecting on too-short input", () => {
    render(<ShopSearchForm />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "ab" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveClass("text-destructive");
  });

  it("clears the error once the user types again", () => {
    render(<ShopSearchForm />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
