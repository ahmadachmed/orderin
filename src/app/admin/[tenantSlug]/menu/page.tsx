"use client";

// Menu management (issue #5): CRUD per PLAN §8 /admin/[tenantSlug]/menu.
// Consumes T2's GET/POST/PATCH/DELETE /api/admin/menu[/itemId].

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  createMenuItem,
  deleteMenuItem,
  fetchMenu,
  updateMenuItem,
} from "@/lib/admin-api";
import type { MenuItem } from "@/types/admin";
import { formatPrice } from "@/types/admin";

interface FormState {
  id?: string;
  name: string;
  description: string;
  price: string;
  prepTimeSeconds: string;
  isAvailable: boolean;
  sortOrder: string;
}

const EMPTY: FormState = {
  name: "",
  description: "",
  price: "",
  prepTimeSeconds: "120",
  isAvailable: true,
  sortOrder: "0",
};

export default function AdminMenuPage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params.tenantSlug;

  const [items, setItems] = useState<MenuItem[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchMenu());
      setAuthError(false);
      setError(null);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Failed to load menu");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (authError && tenantSlug) router.push(`/admin/${tenantSlug}/login`);
  }, [authError, tenantSlug, router]);

  function openCreate() {
    setForm(EMPTY);
    setEditing(false);
  }

  function openEdit(item: MenuItem) {
    setForm({
      id: item.id,
      name: item.name,
      description: item.description ?? "",
      price: String(item.price),
      prepTimeSeconds: String(item.prepTimeSeconds),
      isAvailable: item.isAvailable,
      sortOrder: String(item.sortOrder),
    });
    setEditing(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        price: parseFloat(form.price),
        prepTimeSeconds: parseInt(form.prepTimeSeconds, 10) || 120,
        isAvailable: form.isAvailable,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
      };
      if (editing && form.id) {
        await updateMenuItem(form.id, payload);
      } else {
        await createMenuItem(payload);
      }
      setForm(EMPTY);
      setEditing(false);
      await load();
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this menu item?")) return;
    try {
      await deleteMenuItem(id);
      await load();
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function toggleAvailable(item: MenuItem) {
    try {
      await updateMenuItem(item.id, { isAvailable: !item.isAvailable });
      await load();
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        Session expired — redirecting to login…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Menu management</h1>
            <p className="text-xs text-slate-500">/{tenantSlug}</p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <a
              href={`/admin/${tenantSlug}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Dashboard
            </a>
            <button
              onClick={openCreate}
              className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800"
            >
              + Add item
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {/* Form (create/edit) */}
        {(editing || form.name || form.price) && (
          <form
            onSubmit={onSubmit}
            className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <h2 className="mb-3 font-semibold text-slate-900">
              {editing ? "Edit item" : "New item"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Name *
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Price (IDR) *
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                Description
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Prep time (seconds)
                <input
                  type="number"
                  min={0}
                  value={form.prepTimeSeconds}
                  onChange={(e) =>
                    setForm({ ...form, prepTimeSeconds: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Sort order
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 pt-5 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isAvailable}
                  onChange={(e) =>
                    setForm({ ...form, isAvailable: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                Available
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? "Saving…" : editing ? "Save changes" : "Add item"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY);
                  setEditing(false);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Item list */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Prep</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No menu items yet
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-slate-500">{item.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-700">
                    {formatPrice(item.price)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {item.prepTimeSeconds}s
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleAvailable(item)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.isAvailable
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {item.isAvailable ? "Available" : "Hidden"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => openEdit(item)}
                      className="mr-2 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDelete(item.id)}
                      className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
