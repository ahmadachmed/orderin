"use client";

/**
 * Landing search card (issue #134) — functional shop lookup.
 *
 * Client component: normalizes the typed shop name/slug, validates it with
 * the same SLUG_RE contract as /api/slug-check, and redirects to /[slug] on
 * success (the tenant page 404s via notFound() when the slug doesn't exist).
 * Invalid input renders an inline error instead of navigating.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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

export default function ShopSearchForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

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

    setError(null);
    router.push(`/${slug}`);
  }

  return (
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
  );
}
