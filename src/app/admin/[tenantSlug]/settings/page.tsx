"use client";

// Payment config (issue #7): /admin/[tenantSlug]/settings.
// Tenant payment setup per PLAN §3.3 + §7.2:
//   - QRIS: image URL (uploaded by tenant) or static code string
//   - Bank transfer: account number + bank name
// Consumes GET/PATCH /api/admin/settings. The customer order-status page
// renders these details (QRIS image/code or bank account) for payment.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchSettings, updateSettings } from "@/lib/admin-api";
import type { TenantSettings } from "@/types/admin";

interface FormState {
  qrisImageUrl: string;
  qrisCode: string;
  bankName: string;
  bankAccountNumber: string;
}

export default function AdminSettingsPage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params.tenantSlug;

  const [form, setForm] = useState<FormState>({
    qrisImageUrl: "",
    qrisCode: "",
    bankName: "",
    bankAccountNumber: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s: TenantSettings = await fetchSettings();
      setForm({
        qrisImageUrl: s.qrisImageUrl ?? "",
        qrisCode: s.qrisCode ?? "",
        bankName: s.bankName ?? "",
        bankAccountNumber: s.bankAccountNumber ?? "",
      });
      setAuthError(false);
      setError(null);
      setLoaded(true);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (authError && tenantSlug) router.push(`/admin/${tenantSlug}/login`);
  }, [authError, tenantSlug, router]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateSettings({
        qrisImageUrl: form.qrisImageUrl.trim() || null,
        qrisCode: form.qrisCode.trim() || null,
        bankName: form.bankName.trim() || null,
        bankAccountNumber: form.bankAccountNumber.trim() || null,
      });
      setSaved(true);
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setBusy(false);
    }
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        Session expired — redirecting to login…
      </div>
    );
  }

  const hasQris = Boolean(form.qrisImageUrl.trim() || form.qrisCode.trim());
  const hasBank = Boolean(form.bankName.trim() && form.bankAccountNumber.trim());

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Payment Config</h1>
            <p className="text-xs text-slate-500">/{tenantSlug} · QRIS + bank transfer</p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <a
              href={`/admin/${tenantSlug}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Dashboard
            </a>
            <a
              href={`/admin/${tenantSlug}/menu`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Menu
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-4">
        {!loaded ? (
          <p className="rounded-lg bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
            Memuat pengaturan…
          </p>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            )}
            {saved && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                ✓ Tersimpan — pembeli akan melihat detail pembayaran ini di halaman status pesanan.
              </p>
            )}

            {/* QRIS */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">QRIS</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Pelanggan scan QRIS untuk membayar. Isi salah satu: gambar atau kode statis.
              </p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    URL gambar QRIS
                  </label>
                  <input
                    type="url"
                    value={form.qrisImageUrl}
                    onChange={(e) => set("qrisImageUrl", e.target.value)}
                    placeholder="https://…/qris.png (upload gambar dulu, lalu tempel URL)"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                  />
                  {form.qrisImageUrl.trim() && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.qrisImageUrl.trim()}
                      alt="QRIS preview"
                      className="mt-2 h-28 w-28 rounded-lg border border-slate-200 object-contain"
                    />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Kode QRIS (teks, jika tidak pakai gambar)
                  </label>
                  <input
                    type="text"
                    value={form.qrisCode}
                    onChange={(e) => set("qrisCode", e.target.value)}
                    placeholder="0002010102112665…"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                  />
                </div>
              </div>
            </section>

            {/* Bank transfer */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Transfer Bank</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Pelanggan transfer ke rekening ini, lalu menekan tombol &quot;Saya sudah bayar&quot;.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Nama bank
                  </label>
                  <input
                    type="text"
                    value={form.bankName}
                    onChange={(e) => set("bankName", e.target.value)}
                    placeholder="BCA / BRI / Mandiri…"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    No. rekening
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.bankAccountNumber}
                    onChange={(e) => set("bankAccountNumber", e.target.value)}
                    placeholder="1234567890"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                  />
                </div>
              </div>
            </section>

            {/* Summary + save */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Tampilan untuk pelanggan</h2>
              <p className="mt-1 text-xs text-slate-500">
                {hasQris && hasBank
                  ? "Pelanggan bisa pilih QRIS atau Transfer Bank di halaman status pesanan."
                  : hasQris
                    ? "Pelanggan bisa bayar via QRIS."
                    : hasBank
                      ? "Pelanggan bisa bayar via Transfer Bank."
                      : "Belum ada metode — pelanggan diarahkan ke kasir saat pengambilan."}
              </p>
              <button
                type="submit"
                disabled={busy}
                className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? "Menyimpan…" : "Simpan pengaturan pembayaran"}
              </button>
            </section>
          </form>
        )}
      </main>
    </div>
  );
}
