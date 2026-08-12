"use client";

// Payment config (issue #7): /admin/[tenantSlug]/settings.
// Tenant payment setup per PLAN §3.3 + §7.2:
//   - QRIS: image URL (uploaded by tenant) or static code string
//   - Bank transfer: account number + bank name
// Consumes GET/PATCH /api/admin/settings. The customer order-status page
// renders these details (QRIS image/code or bank account) for payment.
//
// Jam Operasional (T25-10, issue #168): openTime/closeTime stored "HH:mm" UTC,
// displayed in tenant timezone via formatTimeInTimezone (lib/time.ts).
// Client-side validation mirrors the PATCH route (HH:mm, bounds) so bad values
// never leave the form. Zero backend change — reuses existing GET/PATCH.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminLogout, fetchSettings, updateSettings } from "@/lib/admin-api";
import { formatTimeInTimezone } from "@/lib/time";
import type { TenantSettings } from "@/types/admin";

const HH_MM = /^\d{2}:\d{2}$/;

const COMMON_TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
];

interface FormState {
  qrisImageUrl: string;
  qrisCode: string;
  bankName: string;
  bankAccountNumber: string;
  sprintDurationDays: string;
  openTime: string;
  closeTime: string;
  timezone: string;
  isOpen: boolean;
  prepTimeBuffer: string;
  maxQueueSize: string;
}

/** Client-side validation mirroring PATCH /api/admin/settings. Returns error message or null. */
function validateForm(form: FormState): string | null {
  const openTime = form.openTime.trim();
  const closeTime = form.closeTime.trim();
  if (!HH_MM.test(openTime)) return "Jam buka harus format HH:mm (contoh: 07:00)";
  if (!HH_MM.test(closeTime)) return "Jam tutup harus format HH:mm (contoh: 21:00)";
  const tz = form.timezone.trim();
  if (!tz) return "Timezone wajib diisi (contoh: Asia/Jakarta)";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return "Timezone tidak valid — gunakan IANA timezone (contoh: Asia/Jakarta)";
  }
  const buffer = Number(form.prepTimeBuffer);
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 600) {
    return "Buffer waktu racik harus angka bulat 0-600";
  }
  const queue = Number(form.maxQueueSize);
  if (!Number.isInteger(queue) || queue < 1 || queue > 1000) {
    return "Maks antrean harus angka bulat 1-1000";
  }
  return null;
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
    sprintDurationDays: "1",
    openTime: "07:00",
    closeTime: "21:00",
    timezone: "Asia/Makassar",
    isOpen: true,
    prepTimeBuffer: "0",
    maxQueueSize: "20",
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
        sprintDurationDays: String(s.sprintDurationDays ?? 1),
        openTime: s.openTime ?? "07:00",
        closeTime: s.closeTime ?? "21:00",
        timezone: s.timezone || "Asia/Makassar",
        isOpen: s.isOpen ?? true,
        prepTimeBuffer: String(s.prepTimeBuffer ?? 0),
        maxQueueSize: String(s.maxQueueSize ?? 20),
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

  // LOGIN-05: same logout affordance as the dashboard nav.
  async function handleLogout() {
    await adminLogout();
    router.push("/");
    router.refresh();
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateSettings({
        qrisImageUrl: form.qrisImageUrl.trim() || null,
        qrisCode: form.qrisCode.trim() || null,
        bankName: form.bankName.trim() || null,
        bankAccountNumber: form.bankAccountNumber.trim() || null,
        sprintDurationDays: Math.floor(Number(form.sprintDurationDays)) || 1,
        openTime: form.openTime.trim(),
        closeTime: form.closeTime.trim(),
        timezone: form.timezone.trim(),
        isOpen: form.isOpen,
        prepTimeBuffer: Math.floor(Number(form.prepTimeBuffer)),
        maxQueueSize: Math.floor(Number(form.maxQueueSize)),
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

  // T25-10 preview: raw UTC values converted to the tenant timezone.
  const previewOpen = formatTimeInTimezone(form.openTime.trim(), form.timezone.trim());
  const previewClose = formatTimeInTimezone(form.closeTime.trim(), form.timezone.trim());

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
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-rose-200 px-3 py-1.5 font-medium text-rose-600 hover:bg-rose-50"
            >
              Logout
            </button>
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

            {/* Jam Operasional (T25-10) */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Jam Operasional</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Disimpan dalam UTC (HH:mm), ditampilkan dalam timezone kedai. Berlaku untuk jam buka/tutup kedai.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Jam buka
                  </label>
                  <input
                    type="time"
                    value={form.openTime}
                    onChange={(e) => set("openTime", e.target.value)}
                    placeholder="07:00"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Jam tutup
                  </label>
                  <input
                    type="time"
                    value={form.closeTime}
                    onChange={(e) => set("closeTime", e.target.value)}
                    placeholder="21:00"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">Timezone</label>
                <input
                  type="text"
                  list="timezone-options"
                  value={form.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                  placeholder="Asia/Jakarta"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                />
                <datalist id="timezone-options">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-slate-400">
                  contoh: {form.openTime || "07:00"} UTC → {previewOpen}{" "}
                  {previewOpen !== form.openTime.trim() ? `(${form.timezone.trim() || "Asia/Makassar"})` : ""}
                  {previewClose !== previewOpen ? `, ${form.closeTime || "21:00"} UTC → ${previewClose}` : ""}
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-700">Status kedai</p>
                  <p className="text-xs text-slate-500">
                    {form.isOpen ? "Buka — menerima order baru" : "Tutup — tidak menerima order"}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.isOpen}
                  onClick={() => set("isOpen", !form.isOpen)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    form.isOpen ? "bg-emerald-500" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      form.isOpen ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Buffer waktu racik (menit)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={form.prepTimeBuffer}
                    onChange={(e) => set("prepTimeBuffer", e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-400">0-600 menit.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Maks antrean
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={form.maxQueueSize}
                    onChange={(e) => set("maxQueueSize", e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-400">1-1000 order.</p>
                </div>
              </div>
            </section>

            {/* Durasi Sprint */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Durasi Sprint</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Satu sprint = satu periode retensi order. Board hanya menampilkan order sprint aktif.
              </p>
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Durasi sprint (hari)
                </label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={form.sprintDurationDays}
                  onChange={(e) => set("sprintDurationDays", e.target.value)}
                  className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Default 1 hari. Berlaku untuk sprint berikutnya.
                </p>
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
                {busy ? "Menyimpan…" : "Simpan pengaturan"}
              </button>
            </section>
          </form>
        )}
      </main>
    </div>
  );
}
