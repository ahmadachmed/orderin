"use client";

// Shared admin layout (T28 ITEM 1): fixed Sidebar rail + main content area.
// Replaces the per-page top-pill nav. Renders <Sidebar tenantSlug={...} />
// plus a <main> wrapper for page content. T28-2 (issue #196) adds the shared
// top header (shop name + Buka/Tutup toggle) here, visible on every page.

import { useState } from "react";
import { useParams, usePathname } from "next/navigation";
import Sidebar from "@/components/admin/Sidebar";
import OpenToggle from "@/components/admin/OpenToggle";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;
  const pathname = usePathname();
  const [shopName, setShopName] = useState("");

  // Login is pre-auth: render standalone (no sidebar, no ml-64 offset).
  if (pathname.endsWith("/login")) {
    return <div className="min-h-screen bg-muted">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-muted">
      <Sidebar tenantSlug={tenantSlug} />
      <main className="ml-64 min-h-screen">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/95 px-6 py-3">
          <h1 className="text-lg font-semibold text-foreground">
            {shopName || "Orderin"}
          </h1>
          <OpenToggle onLoaded={(settings) => setShopName(settings.name)} />
        </header>
        {children}
      </main>
    </div>
  );
}
