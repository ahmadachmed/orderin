"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface ActiveOrder {
  orderId: string;
  slug: string;
  customerName: string;
  createdAt: number;
}

const STORAGE_KEY = "orderin_orders";
const TERMINAL_STATUSES = new Set(["PICKED_UP", "CANCELLED"]);

/**
 * ActiveOrderBanner — CUST-02 (T16-7, issue #52).
 * Reads the customer's localStorage order registry and, if an order exists
 * for this tenant, shows a "Lanjutkan pesanan" link back to its status page.
 *
 * Issue #210: the registry keeps terminal orders (PICKED_UP / CANCELLED), so
 * the banner rendered for completed orders. On mount we fetch the live order
 * status (GET /api/order/[orderId]) and render nothing for terminal statuses.
 * The registry read stays for fast first paint; the fetched status gates it.
 */
export default function ActiveOrderBanner({ tenantSlug }: { tenantSlug: string }) {
  const [active, setActive] = useState<ActiveOrder | null>(null);
  const [terminal, setTerminal] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const orders: Record<string, ActiveOrder> = JSON.parse(raw);
      const match = Object.values(orders).find((o) => o.slug === tenantSlug);
      if (match) setActive(match);
    } catch {
      /* ignore */
    }
  }, [tenantSlug]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch(`/api/order/${active.orderId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.status && TERMINAL_STATUSES.has(data.status)) {
          setTerminal(true);
        }
      })
      .catch(() => {
        /* network hiccup — keep the fast-paint banner */
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

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
