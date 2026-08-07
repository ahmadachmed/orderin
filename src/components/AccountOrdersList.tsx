"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import type { OrderStatus } from "@/types";

interface OrderSummary {
  orderId: string;
  status: string;
  createdAt: string;
  itemCount: number;
  summary: string;
}

export default function AccountOrdersList({ tenantSlug }: { tenantSlug: string }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/customer/orders")
      .then((r) => r.json())
      .then((data) => setOrders(data.ok !== false ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-neutral-500">Memuat...</p>;
  if (!orders.length) return <p className="text-sm text-neutral-500">Belum ada pesanan.</p>;

  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <Link
          key={o.orderId}
          href={`/${tenantSlug}/order/${o.orderId}`}
          className="block rounded-2xl border border-neutral-200 bg-white p-4 hover:shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-neutral-900">
              #{o.orderId.slice(0, 8).toUpperCase()}
            </span>
            <OrderStatusBadge status={o.status as OrderStatus} />
          </div>
          <p className="mt-1 text-sm text-neutral-600">{o.summary}</p>
          <p className="mt-1 text-xs text-neutral-400">
            {new Date(o.createdAt).toLocaleString("id-ID", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {" · "}{o.itemCount} item
          </p>
        </Link>
      ))}
      <button
        onClick={async () => {
          await fetch("/api/customer/logout", { method: "POST" });
          window.location.href = `/${tenantSlug}`;
        }}
        className="mt-4 text-sm text-red-600"
      >
        Keluar
      </button>
    </div>
  );
}
