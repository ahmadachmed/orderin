"use client";

/**
 * T29-3 (D5) — scroll-to-search + glow, ported from landingpage2.html's
 * vanilla JS (data-scroll="search") into a small client component.
 *
 * Clicking the CTA scrolls the page smoothly to #search-box (the wrapper
 * around ShopSearchForm in the hero card) and plays a 2.4s glow animation.
 * The anchor keeps href="#search-box" as a no-JS fallback (progressive
 * enhancement); onClick prevents the default jump and does the smooth scroll.
 */
const HIGHLIGHT_MS = 2400;

/** Scroll to #search-box and pulse .search-highlight (restart-safe). */
export function scrollToSearch(): void {
  const box = document.getElementById("search-box");
  if (!box) return;

  box.scrollIntoView({ behavior: "smooth", block: "center" });

  // Restart the animation even if it is already running: remove the class,
  // force a reflow (offsetWidth), then re-add it.
  box.classList.remove("search-highlight");
  void box.offsetWidth;
  box.classList.add("search-highlight");

  window.setTimeout(() => {
    box.classList.remove("search-highlight");
  }, HIGHLIGHT_MS);
}

interface ScrollToSearchProps {
  className?: string;
  children: React.ReactNode;
}

export default function ScrollToSearch({
  className,
  children,
}: ScrollToSearchProps) {
  return (
    <a
      href="#search-box"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        scrollToSearch();
      }}
    >
      {children}
    </a>
  );
}
