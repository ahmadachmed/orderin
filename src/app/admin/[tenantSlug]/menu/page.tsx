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
  const [formOpen, setFormOpen] = useState(false);
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
      else setError(err instanceof Error ? err.message : "Gagal memuat menu");
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
    setFormOpen(true);
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
    setFormOpen(true);
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
      setFormOpen(false);
      await load();
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Hapus item menu ini?")) return;
    try {
      await deleteMenuItem(id);
      await load();
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  async function toggleAvailable(item: MenuItem) {
    try {
      await updateMenuItem(item.id, { isAvailable: !item.isAvailable });
      await load();
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Gagal memperbarui");
    }
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted text-sm text-muted-foreground">
        Sesi berakhir — mengalihkan ke login…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">Manajemen Menu</h1>
            <p className="text-xs text-muted-foreground">/{tenantSlug}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        {error && (
          <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
            {error}
          </p>
        )}

        <div className="mb-3 flex justify-end">
          <button
            onClick={openCreate}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + Tambah
          </button>
        </div>

        {/* Form (create/edit) */}
        {formOpen && (
          <form
            onSubmit={onSubmit}
            className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <h2 className="mb-3 font-semibold text-foreground">
              {editing ? "Ubah Item" : "Item Baru"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-foreground">
                Nama *
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Harga (IDR) *
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-foreground sm:col-span-2">
                Deskripsi
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Waktu racik (detik)
                <input
                  type="number"
                  min={0}
                  value={form.prepTimeSeconds}
                  onChange={(e) =>
                    setForm({ ...form, prepTimeSeconds: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Urutan
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 pt-5 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={form.isAvailable}
                  onChange={(e) =>
                    setForm({ ...form, isAvailable: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                Tersedia
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Menyimpan…" : editing ? "Simpan" : "Tambah Item"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY);
                  setEditing(false);
                  setFormOpen(false);
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Batal
              </button>
            </div>
          </form>
        )}

        {/* Item list */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Harga</th>
                <th className="px-4 py-2">Waktu</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Belum ada item menu
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-foreground">
                    {formatPrice(item.price)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {item.prepTimeSeconds}s
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleAvailable(item)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.isAvailable
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {item.isAvailable ? "Tersedia" : "Tersembunyi"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => openEdit(item)}
                      className="mr-2 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      Ubah
                    </button>
                    <button
                      onClick={() => onDelete(item.id)}
                      className="rounded-md border border-rose-500/50 px-2.5 py-1 text-xs font-medium text-rose-400 hover:bg-rose-500/10"
                    >
                      Hapus
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
