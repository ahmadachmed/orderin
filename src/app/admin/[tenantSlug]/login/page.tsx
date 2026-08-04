"use client";

// Admin login (PLAN §3.3: MVP simple username + password; session cookie).
// POST /api/admin/auth is implemented by T2; this page is the UI for it.
// LOGIN-01: on mount, probe GET /api/admin/auth — a valid session skips the
// form and auto-redirects to the dashboard (spinner while probing).

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminLogin, adminDashboardPath, probeAdminSession } from "@/lib/admin-api";

export default function AdminLoginPage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params.tenantSlug;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(true);

  // LOGIN-01: already-authenticated users never see the form — probe the
  // session cookie once on mount, then either redirect or reveal the form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await probeAdminSession();
      if (cancelled) return;
      if (ok) {
        router.push(adminDashboardPath(tenantSlug));
        router.refresh();
      } else {
        setProbing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminLogin(tenantSlug, username, password);
      router.push(adminDashboardPath(tenantSlug));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  }

  if (probing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
          Memeriksa sesi…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-bold text-slate-900">Admin login</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tenantSlug ? `Sign in to /${tenantSlug}` : "Sign in"}
        </p>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
