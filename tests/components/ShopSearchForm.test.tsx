// @vitest-environment jsdom
/**
 * Issue #134 + #142 — ShopSearchForm component tests.
 * Renders the landing search card, normalizes the typed shop name, validates
 * with the SLUG_RE contract, and (issue #142) filters the tenant grid live,
 * redirecting only on an exact single name/slug match.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ShopSearchForm, { normalizeSlug, filterTenants } from "@/components/ShopSearchForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const TENANTS = [
  {
    slug: "kopi-senja",
    name: "Kopi Senja",
    address: "Jl. Senja No. 1",
    isOpen: true,
    phone: "0812",
    openTime: "07:00",
    closeTime: "21:00",
  },
  {
    slug: "kopi-hitam",
    name: "Kopi Hitam",
    address: null,
    isOpen: false,
    phone: null,
    openTime: "08:00",
    closeTime: "17:00",
  },
  {
    slug: "warung-teh",
    name: "Warung Teh",
    address: "Pasar Baru",
    isOpen: true,
  },
];

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

describe("filterTenants", () => {
  it("returns all tenants for an empty query", () => {
    expect(filterTenants(TENANTS, "")).toHaveLength(3);
    expect(filterTenants(TENANTS, "   ")).toHaveLength(3);
  });

  it("matches name case-insensitively as substring", () => {
    expect(filterTenants(TENANTS, "KOPI")).toHaveLength(2);
    expect(filterTenants(TENANTS, "senja")).toHaveLength(1);
  });

  it("matches by normalized slug even when the name differs", () => {
    expect(filterTenants(TENANTS, "warung teh")).toHaveLength(1);
  });

  it("matches slug substring", () => {
    expect(filterTenants(TENANTS, "teh")).toHaveLength(1);
  });

  it("returns nothing when no tenant matches", () => {
    expect(filterTenants(TENANTS, "tidak-ada")).toHaveLength(0);
  });
});

describe("ShopSearchForm", () => {
  it("renders the label contract, #shop-search input and Lanjut button", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    expect(screen.getByLabelText("Masukkan Nama Kedai")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("kopi-senja")).toHaveAttribute("id", "shop-search");
    expect(screen.getByRole("button", { name: /Lanjut/ })).toBeInTheDocument();
  });

  it("renders the full tenant grid initially", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    expect(screen.getByRole("link", { name: /Kopi Senja/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Kopi Hitam/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Warung Teh/ })).toBeInTheDocument();
  });

  it("shows 'Belum ada kedai terdaftar.' when there are no tenants", () => {
    render(<ShopSearchForm tenants={[]} />);
    expect(screen.getByText("Belum ada kedai terdaftar.")).toBeInTheDocument();
  });

  it("filters the grid live as the user types (name substring)", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "hitam" },
    });
    expect(screen.getByRole("link", { name: /Kopi Hitam/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Kopi Senja/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Warung Teh/ })).not.toBeInTheDocument();
  });

  it("restores the full grid when the query is cleared", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "hitam" },
    });
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "" },
    });
    expect(screen.getByRole("link", { name: /Kopi Senja/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Warung Teh/ })).toBeInTheDocument();
  });

  it("redirects to /[slug] on submit with an exact slug match", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi-senja" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).toHaveBeenCalledWith("/kopi-senja");
  });

  it("redirects to /[slug] on submit with an exact name match (case-insensitive)", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "KOPI SENJA" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).toHaveBeenCalledWith("/kopi-senja");
  });

  it("normalizes the typed value before matching the slug", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "Kopi Senja!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).toHaveBeenCalledWith("/kopi-senja");
  });

  it("does not redirect on a partial match — keeps the filtered grid", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Kopi Senja/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Kopi Hitam/ })).toBeInTheDocument();
  });

  it("does not redirect on multiple exact matches — shows both options", () => {
    // Two tenants share the same name → both match exactly, no redirect.
    const dupes = [
      { slug: "kedai-a", name: "Kedai Kopi", address: null, isOpen: true },
      { slug: "kedai-b", name: "Kedai Kopi", address: null, isOpen: false },
    ];
    render(<ShopSearchForm tenants={dupes} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "Kedai Kopi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link", { name: /Kedai Kopi/ })).toHaveLength(2);
  });

  it("shows 'Kedai tidak ditemukan' instead of redirecting on zero matches", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kedai-tidak-ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Kedai tidak ditemukan");
  });

  it("shows an inline error instead of redirecting on empty input", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveClass("text-destructive");
  });

  it("shows an inline error instead of redirecting on too-short input", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "ab" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveClass("text-destructive");
  });

  it("clears the error once the user types again", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ShopSearchForm — LAND-01 timezone display", () => {
  it("shows converted local times (not raw UTC) when the tenant has a timezone", () => {
    const makassar = [
      {
        slug: "kopi-senja",
        name: "Kopi Senja",
        address: "Jl. Senja No. 1",
        isOpen: true,
        phone: "0812",
        openTime: "07:00",
        closeTime: "21:00",
        timezone: "Asia/Makassar",
      },
    ];
    render(<ShopSearchForm tenants={makassar} />);
    expect(screen.getByText(/Buka 15:00–05:00/)).toBeInTheDocument();
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
  });

  it("falls back to raw UTC times when the tenant has no timezone", () => {
    const noTz = [
      {
        slug: "kopi-hitam",
        name: "Kopi Hitam",
        address: null,
        isOpen: true,
        phone: null,
        openTime: "08:00",
        closeTime: "17:00",
      },
    ];
    render(<ShopSearchForm tenants={noTz} />);
    expect(screen.getByText(/Buka 08:00–17:00 UTC/)).toBeInTheDocument();
  });

  it("falls back to raw UTC times when the tenant has an invalid timezone", () => {
    const badTz = [
      {
        slug: "kopi-hitam",
        name: "Kopi Hitam",
        address: null,
        isOpen: true,
        phone: null,
        openTime: "08:00",
        closeTime: "17:00",
        timezone: "Not/AZone",
      },
    ];
    render(<ShopSearchForm tenants={badTz} />);
    expect(screen.getByText(/Buka 08:00–17:00 UTC/)).toBeInTheDocument();
  });
});

describe("ShopSearchForm — T25-5 overnight marker (issue #166)", () => {
  it("appends 'besok' when the converted range wraps past midnight", () => {
    // 07:00–21:00 UTC → 15:00–05:00 WITA: close < open → overnight.
    const overnight = [
      {
        slug: "kopi-senja",
        name: "Kopi Senja",
        address: "Jl. Senja No. 1",
        isOpen: true,
        phone: "0812",
        openTime: "07:00",
        closeTime: "21:00",
        timezone: "Asia/Makassar",
      },
    ];
    render(<ShopSearchForm tenants={overnight} />);
    expect(screen.getByText(/Buka 15:00–05:00 besok/)).toBeInTheDocument();
  });

  it("shows no marker for same-day hours", () => {
    // 00:00–12:00 UTC → 08:00–20:00 WITA: close > open → same day.
    const normal = [
      {
        slug: "kopi-senja",
        name: "Kopi Senja",
        address: null,
        isOpen: true,
        phone: null,
        openTime: "00:00",
        closeTime: "12:00",
        timezone: "Asia/Makassar",
      },
    ];
    render(<ShopSearchForm tenants={normal} />);
    expect(screen.getByText(/Buka 08:00–20:00/)).toBeInTheDocument();
    expect(screen.queryByText(/besok/)).not.toBeInTheDocument();
  });

  it("keeps the UTC suffix (no marker) when timezone is missing", () => {
    const noTz = [
      {
        slug: "kopi-senja",
        name: "Kopi Senja",
        address: null,
        isOpen: true,
        phone: null,
        openTime: "22:00",
        closeTime: "04:00",
      },
    ];
    render(<ShopSearchForm tenants={noTz} />);
    expect(screen.getByText(/Buka 22:00–04:00 UTC/)).toBeInTheDocument();
    expect(screen.queryByText(/besok/)).not.toBeInTheDocument();
  });
});

describe("ShopSearchForm — T24 suggestion dropdown (issue #153)", () => {
  it("renders up to 5 suggestions under the input for a partial keyword", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      slug: `kedai-${i + 1}`,
      name: `Kedai Kopi ${i + 1}`,
      address: `Jl. No. ${i + 1}`,
      isOpen: i % 2 === 0,
    }));
    render(<ShopSearchForm tenants={many} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kedai" },
    });
    const listbox = screen.getByRole("listbox", { name: "Saran kedai" });
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(5);
  });

  it("clicking a suggestion pushes /[slug] without submitting", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "senja" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Kopi Senja/ }));
    expect(push).toHaveBeenCalledWith("/kopi-senja");
  });

  it("shows name, address and status badge on each suggestion", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi" },
    });
    const option = screen.getByRole("option", { name: /Kopi Hitam/ });
    expect(option).toHaveTextContent("Tutup");
    expect(screen.getByRole("option", { name: /Kopi Senja/ })).toHaveTextContent(
      "Jl. Senja No. 1"
    );
  });

  it("hides the dropdown when the query is empty", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi" },
    });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "" },
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("hides the dropdown on zero matches and keeps the existing alert behavior", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kedai-tidak-ada" },
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Kedai tidak ditemukan");
  });

  it("keeps Enter behavior unchanged: exact match redirects, multiple keeps grid", () => {
    render(<ShopSearchForm tenants={TENANTS} />);
    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi-senja" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).toHaveBeenCalledWith("/kopi-senja");
    push.mockClear();

    fireEvent.change(screen.getByPlaceholderText("kopi-senja"), {
      target: { value: "kopi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Kopi Senja/ })).toBeInTheDocument();
  });
});
