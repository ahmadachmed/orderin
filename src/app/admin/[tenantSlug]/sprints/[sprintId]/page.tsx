"use client";

// Sprint detail page (T15, PLAN §4.1/§4.6): /admin/[tenantSlug]/sprints/[sprintId].
// Header nav + SprintDetail component (readonly order list, close action).

import { useParams, useRouter } from "next/navigation";
import { adminLogout } from "@/lib/admin-api";
import SprintDetail from "@/components/admin/SprintDetail";

export default function AdminSprintDetailPage() {
  const router = useRouter();
  const params = useParams<{ tenantSlug: string; sprintId: string }>();
  const tenantSlug = params.tenantSlug;

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
            <h1 className="text-lg font-bold text-slate-900">Detail Sprint</h1>
            <p className="text-xs text-slate-500">/{tenantSlug} · riwayat sprint</p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <a
              href={`/admin/${tenantSlug}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Dashboard
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
              Payment
            </a>
            <a
              href={`/admin/${tenantSlug}/sprints`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Riwayat
            </a>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-rose-200 px-3 py-1.5 font-medium text-rose-600 hover:bg-rose-50"
            >
              Logout
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4">
        <SprintDetail sprintId={params.sprintId} />
      </main>
    </div>
  );
}
