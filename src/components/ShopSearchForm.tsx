"use client";

/**
 * Landing search card (issue #134) + tenant grid filter (issue #142).
 *
 * Client component: receives the server-fetched tenant list as a prop and
 * filters it live as the user types (name case-insensitive substring OR
 * normalized-slug substring). On submit:
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
import { formatTimeInTimezone } from "@/lib/time";

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

interface ShopSearchFormProps {
  tenants: ShopTenant[];
}

export default function ShopSearchForm({ tenants }: ShopSearchFormProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const visible = filterTenants(tenants, value);

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
                          {t.timezone
                            ? `Buka ${formatTimeInTimezone(t.openTime, t.timezone)}–${formatTimeInTimezone(t.closeTime, t.timezone)} · ${t.phone ?? "—"}`
                            : `Buka ${t.openTime}–${t.closeTime} UTC · ${t.phone ?? "—"}`}
                        </p>
                      ) : null}
                    </div>
                    <Badge
                      className={`shrink-0 ${
                        t.isOpen
                          ? "border-success/20 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {t.isOpen ? "Buka" : "Tutup"}
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
