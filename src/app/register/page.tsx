"use client";

// Self-service tenant registration (T8, PLAN §2.3).
// POST /api/register — creates Tenant + TenantAdmin, sets session cookie.

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { validatePasswordMatch } from "@/lib/register-validation";
import { adminDashboardPath } from "@/lib/admin-api";

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function checkSlug(slug: string): Promise<boolean> {
  const res = await fetch(`/api/slug-check?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.available === true;
}

export default function RegisterPage() {
  const router = useRouter();
  const [shopName, setShopName] = useState("");
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userEditedSlug = useRef(false);
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleShopNameChange = useCallback(
    (value: string) => {
      setShopName(value);
      if (!userEditedSlug.current) {
        setSlug(suggestSlug(value));
      }
    },
    []
  );

  const handleSlugChange = useCallback(
    (value: string) => {
      userEditedSlug.current = true;
      setSlug(value);
      // Debounced availability check
      if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
      if (value.length >= 3 && SLUG_RE.test(value)) {
        setCheckingSlug(true);
        slugCheckTimer.current = setTimeout(async () => {
          const available = await checkSlug(value);
          setSlugAvailable(available);
          setCheckingSlug(false);
        }, 500);
      } else {
        setSlugAvailable(null);
        setCheckingSlug(false);
      }
    },
    []
  );

  const slugValid = slug.length >= 3 && slug.length <= 50 && SLUG_RE.test(slug);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password minimal 6 karakter");
      return;
    }
    // REG-08: confirm-password match must be validated client-side before
    // hitting the API — a mismatch should never reach the server.
    const matchError = validatePasswordMatch(password, confirmPassword);
    if (matchError) {
      setError(matchError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: shopName, slug, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Registration failed");
      }
      // REG-10: the register API already set the session cookie — land the
      // user straight on the dashboard, no re-login detour.
      router.push(adminDashboardPath(data.tenant.slug));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm"
      >
        <h1 className="text-xl font-bold text-foreground">Daftar Kedai</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Daftarkan kedai kopi Anda di HeadwayBrew — gratis.
        </p>

        <label className="mt-4 block text-sm font-medium text-foreground">
          Nama Kedai
          <input
            value={shopName}
            onChange={(e) => handleShopNameChange(e.target.value)}
            required
            placeholder="Kopi Senja Makassar"
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-foreground">
          Slug
          <input
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            required
            placeholder="kopi-senja"
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            minLength={3}
            maxLength={50}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
          />
          {slug.length > 0 && (
            <span className="mt-1 inline-block text-xs">
              {!slugValid ? (
                <span className="text-rose-400">
                  Format: huruf kecil, angka, dan dash (contoh: kopi-senja)
                </span>
              ) : checkingSlug ? (
                <span className="text-muted-foreground">Mengecek…</span>
              ) : slugAvailable === true ? (
                <span className="text-emerald-400">✓ Slug tersedia</span>
              ) : slugAvailable === false ? (
                <span className="text-rose-400">✗ Slug sudah dipakai</span>
              ) : null}
            </span>
          )}
        </label>

        <label className="mt-3 block text-sm font-medium text-foreground">
          Username Admin
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-foreground">
          Password Admin
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
          />
          <span className="mt-1 text-xs text-muted-foreground">Minimal 6 karakter</span>
        </label>

        <label className="mt-3 block text-sm font-medium text-foreground">
          Konfirmasi Password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Mendaftarkan…" : "Daftar"}
        </button>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Sudah punya kedai?{" "}
          <Link href="/login" className="font-medium text-sky-400 hover:text-sky-300">
            Login di sini
          </Link>
        </p>
      </form>
    </div>
  );
}
