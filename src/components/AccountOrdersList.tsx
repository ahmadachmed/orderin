"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import type { OrderStatus } from "@/types";

interface OrderSummary {
  orderId: string;
  status: string;
  createdAt: string;
  itemCount: number;
  summary: string;
}

/** Terminal statuses render in the subdued "completed" section (plan §2.9). */
const COMPLETED_STATUSES = ["PICKED_UP", "CANCELLED"];

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

  if (loading) return <p className="text-sm text-muted-foreground">Memuat...</p>;
  if (!orders.length) return <p className="text-sm text-muted-foreground">Belum ada pesanan.</p>;

  const active = orders.filter((o) => !COMPLETED_STATUSES.includes(o.status));
  const completed = orders.filter((o) => COMPLETED_STATUSES.includes(o.status));

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-foreground">Pesanan Aktif</h2>
          {active.map((o) => (
            <Link
              key={o.orderId}
              href={`/${tenantSlug}/order/${o.orderId}`}
              className="block"
            >
              <Card className="p-4 transition-shadow hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold tabular-nums text-primary">
                    #{o.orderId.slice(0, 8).toUpperCase()}
                  </span>
                  <OrderStatusBadge status={o.status as OrderStatus} />
                </div>
                <p className="mt-1 text-sm text-foreground">{o.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(o.createdAt).toLocaleString("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {" · "}
                  {o.itemCount} item
                </p>
              </Card>
            </Link>
          ))}
        </section>
      )}

      {completed.length > 0 && (
        <section className="space-y-3">
          {completed.map((o) => (
            <Card key={o.orderId} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold tabular-nums text-muted-foreground">
                  #{o.orderId.slice(0, 8).toUpperCase()}
                </span>
                <OrderStatusBadge status={o.status as OrderStatus} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{o.summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(o.createdAt).toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {" · "}
                {o.itemCount} item
              </p>
              <Button
                asChild
                className="mt-3 w-full rounded-lg border border-border bg-muted py-3 font-semibold text-primary hover:bg-secondary"
              >
                <Link href={`/${tenantSlug}`}>Pesan Lagi</Link>
              </Button>
            </Card>
          ))}
        </section>
      )}

      <button
        onClick={async () => {
          await fetch("/api/customer/logout", { method: "POST" });
          window.location.href = `/${tenantSlug}`;
        }}
        className="mt-4 text-sm text-destructive"
      >
        Keluar
      </button>
    </div>
  );
}
