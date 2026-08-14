"use client";

/**
 * Landing search card (issue #134) + tenant grid filter (issue #142).
 *
 * Client component: receives the server-fetched tenant list as a prop and
 * filters it live as the user types (name case-insensitive substring OR
 * normalized-slug substring). While typing, a suggestion dropdown (issue
 * #153) lists up to 5 matching kedai under the input — clicking one opens
 * the shop directly. On submit:
 *   - exactly one exact name/slug match  → redirect /[slug]
 *   - multiple matches                   → keep the filtered grid visible
 *   - zero matches                       → inline "Kedai tidak ditemukan" alert
 * Invalid input renders an inline error instead of navigating.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatOperatingHours } from "@/lib/time";
import { effectiveOpen } from "@/lib/open";

/** Same pattern as src/app/api/slug-check/route.ts (T8). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lowercase, trim, spaces → '-', drop anything outside [a-z0-9-]. */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** Tenant shape the landing search + grid need (subset of TenantSummary). */
export interface ShopTenant {
  slug: string;
  name: string;
  address: string | null;
  isOpen: boolean;
  phone?: string | null;
  openTime?: string;
  closeTime?: string;
  /** SETTINGS-05/LAND-01 — IANA zone for displaying opening hours (e.g. "Asia/Makassar"). */
  timezone?: string | null;
  /** #207/#213 — admin Buka/Tutup toggle override window (UTC), from lib/open.ts. */
  isOpenOverrideUntil?: string | Date | null;
}

/** Live filter: name (case-insensitive substring) OR normalized-slug substring. */
export function filterTenants(tenants: ShopTenant[], raw: string): ShopTenant[] {
  const q = raw.trim().toLowerCase();
  if (!q) return tenants;
  const slug = normalizeSlug(q);
  return tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(q) || (slug.length > 0 && t.slug.includes(slug))
  );
}

/**
 * T25-5 — operating-hours label for the landing card. Converts the UTC
 * "HH:mm" pair to the tenant's timezone via formatOperatingHours and appends
 * the "besok" marker when the range wraps past midnight (close < open
 * post-conversion). Null or invalid timezone → raw UTC + "UTC" suffix.
 */
export function formatHoursLabel(
  open: string,
  close: string,
  timezone: string | null | undefined,
  phone?: string | null,
): string {
  const suffix = ` · ${phone ?? "—"}`;
  if (!timezone) return `Buka ${open}–${close} UTC${suffix}`;
  let valid = true;
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: timezone });
  } catch {
    valid = false;
  }
  if (!valid) return `Buka ${open}–${close} UTC${suffix}`;
  const { openDisplay, closeDisplay, isOvernight } = formatOperatingHours(
    open,
    close,
    timezone,
  );
  return `Buka ${openDisplay}–${closeDisplay}${isOvernight ? " besok" : ""}${suffix}`;
}

/**
 * T26/#213 — badge open/closed, konsisten dgn shop page (SOURCE OF TRUTH
 * lib/open.ts `effectiveOpen`): while an admin override is active the toggle
 * flag wins; otherwise the schedule governs. `isOpen` stays a hard gate so a
 * force-closed shop never shows "Buka" even after its override window lapses
 * (legacy T26 semantics preserved when no override is set). Tenant tanpa jam
 * buka → fallback ke flag isOpen saja (behavior lama, jangan break).
 */
export function isShopOpen(t: ShopTenant, now: Date = new Date()): boolean {
  const { openTime, closeTime } = t;
  if (!openTime || !closeTime) return t.isOpen;
  return (
    t.isOpen &&
    effectiveOpen(
      {
        isOpen: t.isOpen,
        openTime,
        closeTime,
        isOpenOverrideUntil: t.isOpenOverrideUntil ?? null,
      },
      now,
    )
  );
}

interface ShopSearchFormProps {
  tenants: ShopTenant[];
}

export default function ShopSearchForm({ tenants }: ShopSearchFormProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const visible = filterTenants(tenants, value);
  // Issue #153 — suggestion dropdown: up to 5 matches while typing.
  const suggestions = value.trim() ? visible.slice(0, 5) : [];

  function handleSuggestionClick(slug: string) {
    setError(null);
    router.push(`/${slug}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const slug = normalizeSlug(value);

    if (!slug) {
      setError("Masukkan nama kedai dulu.");
      return;
    }
    if (slug.length < 3 || slug.length > 50 || !SLUG_RE.test(slug)) {
      setError("Nama kedai tidak valid — minimal 3 karakter (huruf kecil, angka, atau dash).");
      return;
    }

    const q = value.trim().toLowerCase();
    const exact = tenants.filter(
      (t) => t.slug === slug || t.name.toLowerCase() === q
    );

    // Persis satu match (name atau slug) → buka kedai.
    if (exact.length === 1) {
      setError(null);
      router.push(`/${exact[0].slug}`);
      return;
    }
    // Nol match → error inline; banyak/parsial → biarkan grid filter tampil.
    if (visible.length === 0) {
      setError("Kedai tidak ditemukan");
      return;
    }
    setError(null);
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Search / Slug Input Card (kanon beranda.html) */}
      <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-lg">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <label
              htmlFor="shop-search"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Masukkan Nama Kedai
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="shop-search"
                placeholder="kopi-senja"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? true : undefined}
                className="h-12 rounded-lg border-border bg-background pl-11"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {suggestions.length > 0 ? (
              <Card className="mt-1 overflow-hidden rounded-xl border-border shadow-lg">
                <ul role="listbox" aria-label="Saran kedai" className="divide-y divide-border">
                  {suggestions.map((t: ShopTenant) => (
                    <li key={t.slug} role="option">
                      <button
                        type="button"
                        onClick={() => handleSuggestionClick(t.slug)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted active:scale-[0.99]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-foreground">
                            {t.name}
                          </span>
                          {t.address ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {t.address}
                            </span>
                          ) : null}
                        </span>
                        <Badge
                          className={`shrink-0 ${
                            isShopOpen(t)
                              ? "border-success/20 bg-success/10 text-success"
                              : "border-border bg-muted text-muted-foreground"
                          }`}
                        >
                          {isShopOpen(t) ? "Buka" : "Tutup"}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
          <Button
            type="submit"
            className="h-auto w-full rounded-xl py-3.5 font-bold shadow-lg shadow-primary/20"
          >
            <span>Lanjut</span>
            <ArrowRight className="h-5 w-5" />
          </Button>
        </form>
      </section>

      {/* Tenant Grid — filtered live by the query above. */}
      {tenants.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Belum ada kedai terdaftar.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((t: ShopTenant) => (
            <li key={t.slug}>
              <Link href={`/${t.slug}`} className="block">
                <Card className="p-4 transition active:scale-[0.99]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-bold text-foreground">{t.name}</h2>
                      {t.address ? (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">{t.address}</p>
                      ) : null}
                      {t.openTime && t.closeTime ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatHoursLabel(t.openTime, t.closeTime, t.timezone, t.phone)}
                        </p>
                      ) : null}
                    </div>
                    <Badge
                      className={`shrink-0 ${
                        isShopOpen(t)
                          ? "border-success/20 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {isShopOpen(t) ? "Buka" : "Tutup"}
                    </Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
