"use client";

// Monetisation Phase 3 / T18 — Billing card in admin settings (issue #257).
// Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §8.2.
//
// Three states, driven by GET /api/billing/status:
//   FREE            → badge FREE + "Bayar Rp99.000" button → POST /api/billing/upgrade
//                     → redirect to the Duitku hosted payment page.
//   PRO + in grace  → amber banner + "Bayar tagihan" (re-uses the PENDING
//                     invoice the cron already created).
//   PRO active      → "Otomatis diperpanjang tiap bulan" + expiry date
//                     (or "permanen" when planExpiresAt is null — demo tenant).

import { useCallback, useEffect, useState } from "react";
import { fetchBillingStatus, startProUpgrade } from "@/lib/admin-api";
import { PRO_PRICE_IDR } from "@/lib/billing";
import type { BillingStatus } from "@/types/admin";
import { Badge } from "@/components/ui/badge";

const priceLabel = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format(PRO_PRICE_IDR);

export default function BillingCard() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchBillingStatus());
      setError(null);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) {
        setError("Sesi berakhir — muat ulang halaman untuk login.");
      } else {
        setError(err instanceof Error ? err.message : "Gagal memuat status langganan");
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await startProUpgrade();
      if (res.invoiceUrl) {
        window.location.href = res.invoiceUrl;
        return;
      }
      if (res.alreadyPaid) {
        await load(); // plan already active — refresh the card
        return;
      }
      setError("Tagihan belum tersedia — coba lagi.");
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setError("Sesi berakhir — muat ulang halaman untuk login.");
      else setError(err instanceof Error ? err.message : "Gagal membuat tagihan");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <section
        data-testid="billing-card"
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
      >
        <p className="text-sm text-muted-foreground">Memuat status langganan…</p>
      </section>
    );
  }

  const { plan, planExpiresAt, inGrace } = status;
  const expiresLabel = planExpiresAt
    ? new Date(planExpiresAt).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <section
      data-testid="billing-card"
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Langganan PRO</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {priceLabel}/bulan — menu & order tanpa batas, antrean hingga 100.
          </p>
        </div>
        <Badge
          variant={plan === "PRO" ? "default" : "outline"}
          data-testid="billing-plan-badge"
          className={plan === "PRO" ? "" : "text-muted-foreground"}
        >
          {plan}
        </Badge>
      </div>

      {plan === "PRO" && !inGrace && (
        <p className="mt-3 text-sm text-foreground">
          {planExpiresAt === null
            ? "Langganan permanen — tidak ada tagihan bulanan."
            : `Otomatis diperpanjang tiap bulan · aktif s/d ${expiresLabel}.`}
        </p>
      )}

      {plan === "PRO" && inGrace && (
        <div
          role="region"
          aria-label="Status grace"
          data-testid="grace-banner"
          className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
        >
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Langganan berakhir — bayar tagihan untuk lanjut.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {expiresLabel ? `Periode berakhir ${expiresLabel}.` : ""} Masa tenggang 3 hari.
          </p>
        </div>
      )}

      {(plan === "FREE" || inGrace) && (
        <button
          type="button"
          onClick={pay}
          disabled={busy}
          data-testid="pay-button"
          className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Membuat tagihan…" : inGrace ? "Bayar tagihan" : `Bayar ${priceLabel}`}
        </button>
      )}

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </section>
  );
}
