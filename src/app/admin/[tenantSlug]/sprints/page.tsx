"use client";

// Sprint history list (T15, PLAN §4.1/§4.5): /admin/[tenantSlug]/sprints.
// Header nav (Dashboard/Menu/Payment/Riwayat/Shop) + "Buka Sprint Baru",
// body = SprintList table.

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { adminLogout, openSprint } from "@/lib/admin-api";
import SprintList from "@/components/admin/SprintList";

export default function AdminSprintsPage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params.tenantSlug;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setBusy(true);
    setError(null);
    try {
      const res = await openSprint();
      router.push(`/admin/${tenantSlug}/sprints/${res.sprint.id}`);
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) {
        router.push(`/admin/${tenantSlug}/login`);
      } else {
        setError(err instanceof Error ? err.message : "Gagal membuka sprint");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await adminLogout();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Riwayat Sprint</h1>
            <p className="text-xs text-slate-500">/{tenantSlug} · daftar sprint & omzet</p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <a
              href={`/admin/${tenantSlug}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Dasbor
            </a>
            <a
              href={`/admin/${tenantSlug}/menu`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Menu
            </a>
            <a
              href={`/admin/${tenantSlug}/settings`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Pembayaran
            </a>
            <a
              href={`/admin/${tenantSlug}/sprints`}
              className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white"
            >
              Riwayat
            </a>
            <button
              type="button"
              onClick={() => void handleOpen()}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Membuka…" : "+ Buka Sprint Baru"}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-rose-200 px-3 py-1.5 font-medium text-rose-600 hover:bg-rose-50"
            >
              Keluar
            </button>
          </nav>
        </div>
        {error && (
          <div className="mx-auto max-w-7xl px-4 pb-2">
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl p-4">
        <SprintList />
      </main>
    </div>
  );
}
