"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface ActiveOrder {
  orderId: string;
  slug: string;
  customerName: string;
  createdAt?: number;
}

const STORAGE_KEY = "headwaybrew_orders";
const TERMINAL_STATUSES = new Set(["PICKED_UP", "CANCELLED"]);

/**
 * ActiveOrderBanner — CUST-02 (T16-7, issue #52).
 * Reads the customer's localStorage order registry and, if an order exists
 * for this tenant, shows a "Lanjutkan pesanan" link back to its status page.
 *
 * Issue #210: the registry keeps terminal orders (PICKED_UP / CANCELLED), so
 * the banner rendered for completed orders. On mount we fetch the live order
 * status (GET /api/order/[orderId]) and render nothing for terminal statuses.
 *
 * Issue #215: `Object.values(orders).find(slug)` picked the FIRST registry
 * entry (oldest order, insertion order). When that one was terminal, the
 * banner hid even though a newer, still-active order existed. Now we sort
 * candidates by createdAt desc (newest first) and scan them in order,
 * fetching each candidate's live status until a non-terminal one is found —
 * that one becomes the banner; if every candidate is terminal, render null.
 * The registry is small (1-3 entries per tenant), so the loop is bounded.
 * A fetch failure is treated as non-terminal so the banner still renders on
 * network hiccups (matches the pre-#215 fast-paint behaviour).
 */
export default function ActiveOrderBanner({ tenantSlug }: { tenantSlug: string }) {
  const [active, setActive] = useState<ActiveOrder | null>(null);
  const [terminal, setTerminal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const orders: Record<string, ActiveOrder> = JSON.parse(raw);
      const candidates = Object.values(orders)
        .filter((o) => o.slug === tenantSlug)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      if (candidates.length === 0) return;

      (async () => {
        for (const candidate of candidates) {
          if (cancelled) return;
          let status: string | null = null;
          try {
            const res = await fetch(`/api/order/${candidate.orderId}`, {
              cache: "no-store",
            });
            const data = res.ok ? await res.json() : null;
            status = data?.status ?? null;
          } catch {
            /* network hiccup — treat as non-terminal, keep the banner */
          }
          if (cancelled) return;
          if (!status || !TERMINAL_STATUSES.has(status)) {
            setActive(candidate);
            return;
          }
        }
        setTerminal(true);
      })();
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  if (!active || terminal) return null;

  return (
    <Link
      href={`/${active.slug}/order/${active.orderId}`}
      className="mb-4 block rounded-xl border border-primary/20 bg-primary/10 p-3 text-primary"
    >
      📋 Lanjutkan pesanan {active.customerName} →
    </Link>
  );
}
