"use client";

// Sprint list (T15, PLAN §4.5): table of every sprint for the admin's tenant
// — Tanggal Mulai | Status | #Order | Omzet (PAID) | Aksi. Row click navigates
// to the sprint detail. OPEN = emerald badge, CLOSED = slate badge.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchSprints } from "@/lib/admin-api";
import type { SprintStatus, SprintSummary } from "@/types/admin";
import { formatPrice } from "@/types/admin";

const BADGE: Record<SprintStatus, string> = {
  OPEN: "bg-emerald-100 text-emerald-800 border-emerald-300",
  CLOSED: "bg-slate-200 text-slate-600 border-slate-300",
};

function formatStart(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SprintList() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params.tenantSlug;

  const [sprints, setSprints] = useState<SprintSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setSprints(await fetchSprints());
      setAuthError(false);
      setError(null);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Failed to load sprints");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // LOGIN-05: expired session → login page.
  useEffect(() => {
    if (authError && tenantSlug) router.push(`/admin/${tenantSlug}/login`);
  }, [authError, tenantSlug, router]);

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        Session expired — redirecting to login…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error} — retrying…
        </p>
      )}
      {!loaded ? (
        <p className="py-6 text-center text-sm text-slate-400">Memuat riwayat…</p>
      ) : sprints.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          Belum ada sprint. Buka sprint baru dari tombol di atas.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <th className="pb-2 pr-4 font-medium">Tanggal Mulai</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 text-right font-medium">#Order</th>
              <th className="pb-2 pr-4 text-right font-medium">Omzet (PAID)</th>
              <th className="pb-2 font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {sprints.map((s) => (
              <tr
                key={s.id}
                onClick={() =>
                  router.push(`/admin/${tenantSlug}/sprints/${s.id}`)
                }
                className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="py-2.5 pr-4 text-slate-900">
                  {formatStart(s.startAt)}
                </td>
                <td className="py-2.5 pr-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE[s.status]}`}
                  >
                    {s.status === "OPEN" ? "Open" : "Closed"}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-slate-700">
                  {s.orderCount}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-slate-900">
                  {formatPrice(s.revenue)}
                </td>
                <td className="py-2.5 font-medium text-slate-500">
                  Detail →
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
