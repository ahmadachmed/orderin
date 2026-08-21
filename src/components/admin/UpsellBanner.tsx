"use client";

// Monetisasi Phase 1 / T12 (issue #229) + Phase 3 UX (issue #257) — Upsell
// banner in admin dashboard.
//
// Shows a dismissible banner ONLY on FREE-plan tenants. PRO tenants never see
// it because `can(plan, "upsellBanner")` returns false for PRO.
//
// The banner is informational with a CTA to the public pricing page — no
// payment buttons (the actual upgrade flow lives in BillingCard on the
// settings page). CTA text says "Lihat paket PRO" so the merchant can learn
// about the plan before paying.
//
// Dismiss state persists in localStorage so once a merchant closes the banner
// it stays closed across sessions until the key is manually cleared.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { fetchSettings } from "@/lib/admin-api";
import { can } from "@/lib/plan";
import type { Plan } from "@/generated/prisma/enums";

const DISMISS_KEY = "hb:upsell-banner-dismissed";

export default function UpsellBanner() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Load tenant plan + dismiss state on mount.
  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((settings) => {
        if (cancelled) return;
        setPlan(settings.plan);
      })
      .catch(() => {
        // If settings fail to load we just don't show the banner —
        // it's a non-critical UI element.
        if (cancelled) return;
        setPlan(null);
      });

    // Check localStorage for prior dismissal.
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      if (stored === "1") setDismissed(true);
    } catch {
      // localStorage unavailable (SSR, privacy mode) — default to showing.
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // While settings are loading, render nothing (avoids flash).
  if (plan === null) return null;

  // PRO tenants never see the banner.
  if (!can(plan, "upsellBanner")) return null;

  // FREE tenant dismissed it previously — don't show again.
  if (dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // localStorage unavailable — state-only dismissal (this session).
    }
  }

  return (
    <div
      role="region"
      aria-label="Informasi paket"
      className="relative flex items-center gap-3 overflow-hidden border-b border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-orange-500/10 px-4 py-3"
    >
      <Sparkles className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">
          Tingkatkan ke paket PRO
        </p>
        <p className="text-xs text-muted-foreground">
          Buka menu tanpa batas, antrean lebih panjang, dan retensi sprint 30 hari.
        </p>
      </div>
      <Link
        href="/pricing"
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Lihat paket PRO
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Tutup banner"
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
