"use client";

// Admin sidebar rail (T28 ITEM 1): fixed left rail replacing the per-page
// top-pill nav. Items (Indonesian): Dasbor / Menu / Riwayat / Pengaturan,
// plus Keluar (logout button, red) reusing adminLogout() + redirect "/".
// D1: Riwayat (sprints) is the 5th item. D2: "Lihat Toko" dropped.

import { usePathname, useRouter } from "next/navigation";
import {
  History,
  LayoutDashboard,
  LogOut,
  Settings,
  UtensilsCrossed,
} from "lucide-react";
import { adminLogout } from "@/lib/admin-api";

interface SidebarProps {
  tenantSlug: string;
}

const NAV_ITEMS = [
  { href: (slug: string) => `/admin/${slug}`, label: "Dasbor", icon: LayoutDashboard },
  { href: (slug: string) => `/admin/${slug}/menu`, label: "Menu", icon: UtensilsCrossed },
  { href: (slug: string) => `/admin/${slug}/sprints`, label: "Riwayat", icon: History },
  { href: (slug: string) => `/admin/${slug}/settings`, label: "Pengaturan", icon: Settings },
] as const;

export default function Sidebar({ tenantSlug }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await adminLogout();
    router.push("/");
    router.refresh();
  }

  const dashboardHref = `/admin/${tenantSlug}`;

  const isActive = (href: string) =>
    pathname === href ||
    (href !== dashboardHref && pathname.startsWith(`${href}/`));

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-border bg-card">
      <div className="px-6 py-5">
        <p className="text-xl font-bold tracking-tight text-foreground">HeadwayBrew</p>
        <p className="mt-0.5 text-xs font-medium tracking-wide text-muted-foreground">
          Admin Console
        </p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Navigasi admin">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const target = href(tenantSlug);
          const active = isActive(target);
          return (
            <a
              key={target}
              href={target}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </a>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/10"
        >
          <LogOut className="h-5 w-5" />
          Keluar
        </button>
      </div>
    </aside>
  );
}
