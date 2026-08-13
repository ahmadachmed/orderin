"use client";

// Sprint detail page (T15, PLAN §4.1/§4.6): /admin/[tenantSlug]/sprints/[sprintId].
// Back-link lives in SprintDetail; nav now comes from the shared admin sidebar.

import { useParams } from "next/navigation";
import SprintDetail from "@/components/admin/SprintDetail";

export default function AdminSprintDetailPage() {
  const params = useParams<{ tenantSlug: string; sprintId: string }>();
  const tenantSlug = params.tenantSlug;

  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">Detail Sprint</h1>
            <p className="text-xs text-muted-foreground">/{tenantSlug} · riwayat sprint</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4">
        <SprintDetail sprintId={params.sprintId} />
      </main>
    </div>
  );
}
