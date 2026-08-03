// Admin API client (T4). Consumes the §9.2 contract implemented by T2:
//   POST   /api/admin/auth                 login (session cookie)
//   GET    /api/admin/orders               active orders
//   PATCH  /api/admin/orders/[orderId]     update status / payment
//   GET    /api/admin/menu                 list menu
//   POST   /api/admin/menu                 create item
//   PATCH  /api/admin/menu/[itemId]        update item
//   DELETE /api/admin/menu/[itemId]        delete item
//   GET    /api/admin/settings             read tenant settings (issue #7)
//   PATCH  /api/admin/settings             update tenant settings
//
// Fetch wrappers are normalized so the UI tolerates both
// `{ orders: [...] }` and bare-array responses from T2.

import type { MenuItem, Order, TenantSettings } from "@/types/admin";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
      else if (body?.message) detail = body.message;
    } catch {
      // non-JSON error body — keep statusText
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function adminLogin(
  tenantSlug: string,
  username: string,
  password: string,
): Promise<{ ok: boolean }> {
  return req("/api/admin/auth", {
    method: "POST",
    body: JSON.stringify({ tenantSlug, username, password }),
  });
}

export async function adminLogout(): Promise<void> {
  await req("/api/admin/auth", { method: "DELETE" }).catch(() => undefined);
}

export async function fetchOrders(): Promise<Order[]> {
  const data = await req<Order[] | { orders: Order[] }>("/api/admin/orders");
  return Array.isArray(data) ? data : (data.orders ?? []);
}

export async function updateOrder(
  orderId: string,
  patch: Partial<Pick<Order, "status" | "paymentStatus" | "paymentMethod">>,
): Promise<Order> {
  return req<Order>(`/api/admin/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function fetchMenu(): Promise<MenuItem[]> {
  const data = await req<MenuItem[] | { items: MenuItem[] }>("/api/admin/menu");
  return Array.isArray(data) ? data : (data.items ?? []);
}

export async function createMenuItem(item: {
  name: string;
  description?: string;
  price: number;
  prepTimeSeconds: number;
  isAvailable?: boolean;
  sortOrder?: number;
}): Promise<MenuItem> {
  return req("/api/admin/menu", {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export async function updateMenuItem(
  itemId: string,
  patch: Partial<{
    name: string;
    description: string;
    price: number;
    prepTimeSeconds: number;
    isAvailable: boolean;
    sortOrder: number;
  }>,
): Promise<MenuItem> {
  return req(`/api/admin/menu/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteMenuItem(itemId: string): Promise<void> {
  await req(`/api/admin/menu/${itemId}`, { method: "DELETE" });
}

export async function fetchSettings(): Promise<TenantSettings> {
  return req<TenantSettings>("/api/admin/settings");
}

export async function updateSettings(
  patch: Partial<TenantSettings>,
): Promise<TenantSettings> {
  return req("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
