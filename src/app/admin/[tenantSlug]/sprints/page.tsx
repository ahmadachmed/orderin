"use client";

// Sprint history list (T15, PLAN §4.1/§4.5): /admin/[tenantSlug]/sprints.
// Header nav (Dashboard/Menu/Payment/Riwayat/Shop) + "Buka Sprint Baru",
// body = SprintList table.

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { openSprint } from "@/lib/admin-api";
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

  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">Riwayat Sprint</h1>
            <p className="text-xs text-muted-foreground">/{tenantSlug} · daftar sprint & omzet</p>
          </div>
        </div>
        {error && (
          <div className="mx-auto max-w-7xl px-4 pb-2">
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {error}
            </p>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl p-4">
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleOpen()}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Membuka…" : "+ Buka Sprint Baru"}
          </button>
        </div>
        <SprintList />
      </main>
    </div>
  );
}
