// @vitest-environment jsdom
/**
 * T29-3 (issue #247) — scroll-to-search + glow.
 * Clicking the Pesan Sekarang CTA calls scrollIntoView({behavior:'smooth',
 * block:'center'}) on #search-box and toggles .search-highlight for 2.4s
 * (class removed by the timeout; re-click restarts the animation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ScrollToSearch from "@/components/landing/ScrollToSearch";

function installSearchBox() {
  const box = document.createElement("div");
  box.id = "search-box";
  document.body.appendChild(box);
  return box;
}

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  installSearchBox();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  // restore scrollIntoView so other suites aren't affected
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("ScrollToSearch", () => {
  it("click → smooth scrollIntoView block:center on #search-box", () => {
    render(<ScrollToSearch className="cta">Pesan Sekarang</ScrollToSearch>);

    const link = screen.getByRole("link", { name: "Pesan Sekarang" });
    expect(link).toHaveAttribute("href", "#search-box");
    expect(link).toHaveClass("cta");

    fireEvent.click(link);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("adds .search-highlight on click, removes it after 2.4s", () => {
    render(<ScrollToSearch>Pesan Sekarang</ScrollToSearch>);
    const box = document.getElementById("search-box")!;

    fireEvent.click(screen.getByRole("link"));
    expect(box.classList.contains("search-highlight")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2400);
    });
    expect(box.classList.contains("search-highlight")).toBe(false);
  });

  it("re-click restarts the glow (class persists past first timeout)", () => {
    render(<ScrollToSearch>Pesan Sekarang</ScrollToSearch>);
    const box = document.getElementById("search-box")!;
    const link = screen.getByRole("link");

    fireEvent.click(link);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    fireEvent.click(link);
    expect(box.classList.contains("search-highlight")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2400);
    });
    expect(box.classList.contains("search-highlight")).toBe(false);
  });

  it("no-op when #search-box is missing (no crash)", () => {
    document.getElementById("search-box")!.remove();
    render(<ScrollToSearch>Pesan Sekarang</ScrollToSearch>);

    expect(() =>
      fireEvent.click(screen.getByRole("link")),
    ).not.toThrow();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
