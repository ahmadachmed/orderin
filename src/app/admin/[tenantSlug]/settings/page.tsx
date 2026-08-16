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
import { fetchSettings, updateSettings } from "@/lib/admin-api";
import { formatTimeInTimezone, localToUtcHHmm, formatOperatingHours } from "@/lib/time";
import { nextBoundary } from "@/lib/open";
import { Badge } from "@/components/ui/badge";
import type { Plan, TenantSettings } from "@/types/admin";

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
  // Monetisation Phase 0 / T5 — plan status display (read-only, issue #229).
  // plan + contactEmail come from GET /api/admin/settings (T4) and are
  // display-only here — the PATCH route rejects mutations to plan/isActive.
  const [plan, setPlan] = useState<Plan>("FREE");
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [busy, setBusy] = useState(false);
  // #207 v2: the Status kedai switch is a time-boxed override — only when the
  // admin actually toggles it does the save attach isOpenOverrideUntil
  // (next schedule boundary). Editing other fields alone must NOT create an
  // override, or an unrelated save would silently change open state.
  const [isOpenTouched, setIsOpenTouched] = useState(false);

  const load = useCallback(async () => {
    try {
      const s: TenantSettings = await fetchSettings();
      // Input shows LOCAL time: stored UTC → tenant timezone. Null/invalid
      // timezone → raw fallback (no conversion, matches formatTimeInTimezone).
      const tz = s.timezone || "";
      setForm({
        qrisImageUrl: s.qrisImageUrl ?? "",
        qrisCode: s.qrisCode ?? "",
        bankName: s.bankName ?? "",
        bankAccountNumber: s.bankAccountNumber ?? "",
        sprintDurationDays: String(s.sprintDurationDays ?? 1),
        openTime: formatTimeInTimezone(s.openTime ?? "07:00", tz),
        closeTime: formatTimeInTimezone(s.closeTime ?? "21:00", tz),
        timezone: tz,
        isOpen: s.isOpen ?? true,
        prepTimeBuffer: String(s.prepTimeBuffer ?? 0),
        maxQueueSize: String(s.maxQueueSize ?? 20),
      });
      // T5 — read-only plan + contactEmail for badge display (issue #229)
      setPlan(s.plan);
      setContactEmail(s.contactEmail ?? null);
      setAuthError(false);
      setError(null);
      setLoaded(true);
      setIsOpenTouched(false);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Gagal memuat pengaturan");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (authError && tenantSlug) router.push(`/admin/${tenantSlug}/login`);
  }, [authError, tenantSlug, router]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  /**
   * Timezone change — re-interpret the displayed LOCAL times in the new
   * timezone: current local → UTC (old tz) → local (new tz). Invalid old tz
   * means the display was raw UTC (identity via localToUtcHHmm fallback);
   * invalid new tz falls back to raw via formatTimeInTimezone.
   */
  function handleTimezoneChange(nextTz: string) {
    setForm((prev) => {
      const prevTz = prev.timezone.trim();
      const openUtc = localToUtcHHmm(prev.openTime.trim(), prevTz);
      const closeUtc = localToUtcHHmm(prev.closeTime.trim(), prevTz);
      return {
        ...prev,
        timezone: nextTz,
        openTime: formatTimeInTimezone(openUtc, nextTz.trim()),
        closeTime: formatTimeInTimezone(closeUtc, nextTz.trim()),
      };
    });
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
      // Input is LOCAL time — convert to stored UTC before PATCH.
      // Invalid timezone already rejected by validateForm; localToUtcHHmm
      // additionally falls back to raw (identity) if it slips through.
      const tz = form.timezone.trim();
      const openUtc = localToUtcHHmm(form.openTime.trim(), tz);
      const closeUtc = localToUtcHHmm(form.closeTime.trim(), tz);
      await updateSettings({
        qrisImageUrl: form.qrisImageUrl.trim() || null,
        qrisCode: form.qrisCode.trim() || null,
        bankName: form.bankName.trim() || null,
        bankAccountNumber: form.bankAccountNumber.trim() || null,
        openTime: openUtc,
        closeTime: closeUtc,
        timezone: tz,
        isOpen: form.isOpen,
        // #207 v2: toggle = time-boxed override expiring at the next boundary
        // (nextBoundary expects UTC "HH:mm" — the schedule is stored UTC).
        ...(isOpenTouched
          ? {
              isOpenOverrideUntil: nextBoundary(openUtc, closeUtc).toISOString(),
            }
          : {}),
        prepTimeBuffer: Math.floor(Number(form.prepTimeBuffer)),
        maxQueueSize: Math.floor(Number(form.maxQueueSize)),
      });
      setSaved(true);
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Gagal menyimpan pengaturan");
    } finally {
      setBusy(false);
    }
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted text-sm text-muted-foreground">
        Sesi berakhir — mengalihkan ke login…
      </div>
    );
  }

  const hasQris = Boolean(form.qrisImageUrl.trim() || form.qrisCode.trim());
  const hasBank = Boolean(form.bankName.trim() && form.bankAccountNumber.trim());

  // Preview: the form holds LOCAL values; convert back to UTC so
  // formatOperatingHours re-renders them as local (round-trip identity)
  // and flags overnight ranges — visual confirmation for the admin.
  const previewOpenUtc = localToUtcHHmm(form.openTime.trim(), form.timezone.trim());
  const previewCloseUtc = localToUtcHHmm(form.closeTime.trim(), form.timezone.trim());
  const { openDisplay: previewOpen, closeDisplay: previewClose, isOvernight } =
    formatOperatingHours(previewOpenUtc, previewCloseUtc, form.timezone.trim());

  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-foreground">Pengaturan</h1>
              {/* Monetisation Phase 0 / T5 — plan status badge (read-only, issue #229) */}
              <Badge
                variant={plan === "PRO" ? "default" : "outline"}
                data-testid="plan-badge"
                className={plan === "PRO" ? "" : "text-muted-foreground"}
              >
                {plan}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              /{tenantSlug} · QRIS + transfer bank
              {contactEmail ? ` · ${contactEmail}` : ""}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-4">
        {!loaded ? (
          <p className="rounded-lg bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            Memuat pengaturan…
          </p>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {error && (
              <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">{error}</p>
            )}
            {saved && (
              <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
                ✓ Tersimpan — pembeli akan melihat detail pembayaran ini di halaman status pesanan.
              </p>
            )}

            {/* QRIS */}
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">QRIS</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pelanggan scan QRIS untuk membayar. Isi salah satu: gambar atau kode statis.
              </p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    URL gambar QRIS
                  </label>
                  <input
                    type="url"
                    value={form.qrisImageUrl}
                    onChange={(e) => set("qrisImageUrl", e.target.value)}
                    placeholder="https://…/qris.png (upload gambar dulu, lalu tempel URL)"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  />
                  {form.qrisImageUrl.trim() && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.qrisImageUrl.trim()}
                      alt="QRIS preview"
                      className="mt-2 h-28 w-28 rounded-lg border border-border object-contain"
                    />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Kode QRIS (teks, jika tidak pakai gambar)
                  </label>
                  <input
                    type="text"
                    value={form.qrisCode}
                    onChange={(e) => set("qrisCode", e.target.value)}
                    placeholder="0002010102112665…"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  />
                </div>
              </div>
            </section>

            {/* Bank transfer */}
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">Transfer Bank</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pelanggan transfer ke rekening ini, lalu menekan tombol &quot;Saya sudah bayar&quot;.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Nama bank
                  </label>
                  <input
                    type="text"
                    value={form.bankName}
                    onChange={(e) => set("bankName", e.target.value)}
                    placeholder="BCA / BRI / Mandiri…"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    No. rekening
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.bankAccountNumber}
                    onChange={(e) => set("bankAccountNumber", e.target.value)}
                    placeholder="1234567890"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  />
                </div>
              </div>
            </section>

            {/* Jam Operasional (T25-10) */}
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">Jam Operasional</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Diisi dalam waktu LOKAL kedai (timezone di bawah), disimpan sebagai UTC. Berlaku untuk jam buka/tutup kedai.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Jam buka
                  </label>
                  <input
                    type="time"
                    value={form.openTime}
                    onChange={(e) => set("openTime", e.target.value)}
                    placeholder="07:00"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Jam tutup
                  </label>
                  <input
                    type="time"
                    value={form.closeTime}
                    onChange={(e) => set("closeTime", e.target.value)}
                    placeholder="21:00"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Timezone</label>
                <input
                  type="text"
                  list="timezone-options"
                  value={form.timezone}
                  onChange={(e) => handleTimezoneChange(e.target.value)}
                  placeholder="Asia/Jakarta"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                />
                <datalist id="timezone-options">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-muted-foreground">
                  contoh: {previewOpen || "07:00"} lokal{" "}
                  {previewClose !== previewOpen ? `– ${previewClose} lokal` : ""}{" "}
                  {isOvernight ? "(besok) " : ""}→ tersimpan {previewOpenUtc || "07:00"}
                  {previewCloseUtc !== previewOpenUtc ? ` – ${previewCloseUtc}` : ""} UTC
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">Status kedai</p>
                  <p className="text-xs text-muted-foreground">
                    {form.isOpen
                      ? "Buka (sementara) — otomatis kembali ke jadwal di jam berikutnya"
                      : "Tutup (sementara) — otomatis kembali ke jadwal di jam berikutnya"}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.isOpen}
                  onClick={() => {
                    set("isOpen", !form.isOpen);
                    setIsOpenTouched(true);
                  }}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    form.isOpen ? "bg-emerald-500" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${
                      form.isOpen ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Buffer waktu racik (menit)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={form.prepTimeBuffer}
                    onChange={(e) => set("prepTimeBuffer", e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">0-600 menit.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Maks antrean
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={form.maxQueueSize}
                    onChange={(e) => set("maxQueueSize", e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">1-1000 order.</p>
                </div>
              </div>
            </section>

            {/* Retensi Sprint — T11: plan-derived (FREE 1d, PRO 30d) */}
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">Retensi Sprint</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Riwayat sprint disimpan sesuai paket Anda. Board hanya menampilkan order dari sprint aktif.
              </p>
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Retensi riwayat sprint
                </label>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground">
                    {plan === "PRO" ? "30 hari" : "1 hari"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Paket {plan} · diatur oleh paket, tidak dapat diubah di sini.
                  </span>
                </div>
              </div>
            </section>

            {/* Summary + save */}
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">Tampilan untuk pelanggan</h2>
              <p className="mt-1 text-xs text-muted-foreground">
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
                className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
