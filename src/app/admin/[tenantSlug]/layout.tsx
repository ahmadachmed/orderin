"use client";

// Shared admin layout (T28 ITEM 1): fixed Sidebar rail + main content area.
// Replaces the per-page top-pill nav. Renders <Sidebar tenantSlug={...} />
// plus a <main> wrapper for page content. T28-2 adds the shared top header
// (shop name + Buka/Tutup toggle) here.

import { useParams, usePathname } from "next/navigation";
import Sidebar from "@/components/admin/Sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;
  const pathname = usePathname();

  // Login is pre-auth: render standalone (no sidebar, no ml-64 offset).
  if (pathname.endsWith("/login")) {
    return <div className="min-h-screen bg-slate-100">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar tenantSlug={tenantSlug} />
      <main className="ml-64 min-h-screen">{children}</main>
    </div>
  );
}
