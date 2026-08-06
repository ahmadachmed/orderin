"use client";
import { useEffect } from "react";

/**
 * OrderPersistence — CUST-02 (T16-7, issue #52) defensive write.
 * Saves the order into localStorage on status-page mount, catching orders
 * that were never persisted by OrderForm (e.g. shared links, back-button
 * revisits).
 */
export default function OrderPersistence({ orderId, slug }: { orderId: string; slug: string }) {
  useEffect(() => {
    try {
      const raw = localStorage.getItem("orderin_orders") ?? "{}";
      const orders = JSON.parse(raw);
      orders[orderId] = { ...orders[orderId], orderId, slug, lastSeen: Date.now() };
      localStorage.setItem("orderin_orders", JSON.stringify(orders));
    } catch {
      /* ignore */
    }
  }, [orderId, slug]);
  return null;
}
