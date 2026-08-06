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

/**
 * ActiveOrderBanner — CUST-02 (T16-7, issue #52).
 * Reads the customer's localStorage order registry and, if an order exists
 * for this tenant, shows a "Lanjutkan pesanan" link back to its status page.
 */
export default function ActiveOrderBanner({ tenantSlug }: { tenantSlug: string }) {
  const [active, setActive] = useState<ActiveOrder | null>(null);

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

  if (!active) return null;

  return (
    <Link
      href={`/${active.slug}/order/${active.orderId}`}
      className="mb-4 block rounded-xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100"
    >
      📋 Lanjutkan pesanan {active.customerName} →
    </Link>
  );
}
