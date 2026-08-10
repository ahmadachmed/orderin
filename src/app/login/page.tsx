"use client";

// Owner (admin) login — /login (issue #141).
// Landing = customer-only; kedai owners sign in here. POST /api/admin/auth
// (slug + username + password → HMAC session cookie); on success the owner
// lands on their dashboard. Probe GET /api/admin/auth on mount: a valid
// session skips the form and redirects straight to the dashboard (LOGIN-01
// pattern from /admin/[tenantSlug]/login — the slug comes from localStorage,
// recorded on the last successful login, since /login carries no slug).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Store, User, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { adminDashboardPath, probeAdminSession } from "@/lib/admin-api";

const LAST_SLUG_KEY = "orderin:last-tenant-slug";

function readLastSlug(): string | null {
  try {
    return window.localStorage.getItem(LAST_SLUG_KEY);
  } catch {
    return null;
  }
}

function writeLastSlug(slug: string) {
  try {
    window.localStorage.setItem(LAST_SLUG_KEY, slug);
  } catch {
    // private mode etc. — non-fatal
  }
}

export default function OwnerLoginPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(true);

  // Valid session → straight to the dashboard (no form). The slug isn't in
  // the URL here (unlike /admin/[tenantSlug]/login), so fall back to the
  // slug recorded by the last successful login; if there is none, show the
  // form — logging in again just re-issues the session cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await probeAdminSession();
      if (cancelled) return;
      if (ok) {
        const lastSlug = readLastSlug();
        if (lastSlug) {
          router.push(adminDashboardPath(lastSlug));
          router.refresh();
          return;
        }
      }
      setProbing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Gagal masuk");
      writeLastSlug(data.tenant.slug);
      router.push(adminDashboardPath(data.tenant.slug));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk");
      setBusy(false);
    }
  }

  if (probing) {
    return (
      <div className="flex min-h-[calc(100vh-1rem)] items-center justify-center py-8">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
          Memeriksa sesi…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-1rem)] items-center justify-center py-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl font-extrabold tracking-tight">
            Login Pemilik Kedai
          </CardTitle>
          <CardDescription>
            Masuk untuk mengelola kedai Anda di Orderin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="relative">
              <Store className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="Slug kedai (mis. kopi-senja)"
                className="h-11 rounded-xl bg-background pl-9"
                autoComplete="off"
                required
              />
            </div>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="h-11 rounded-xl bg-background pl-9"
                autoComplete="username"
                required
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="h-11 rounded-xl bg-background pl-9"
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Masuk…" : "Masuk"}
            </Button>

            <p className="pt-1 text-center text-sm text-muted-foreground">
              Sudah punya akun? Daftar kedai{" "}
              <Link href="/register" className="font-medium text-primary hover:underline">
                di sini
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
