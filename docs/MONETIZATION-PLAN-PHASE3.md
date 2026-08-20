# Monetization Phase 3 — Xendit Billing + Pricing Rp99.000

**Status:** Plan (siap eksekusi oleh pioneer) · **Owner:** @senior · **Date:** 2026-08-20
**Gate:** Phase 0+1 (issue #229) sudah merged — tier FREE/PRO, feature gates, badge, upsell banner.
**Yang belum ada:** mekanisme tenant **BAYAR → upgrade ke PRO**.

---

## 1. Ringkasan eksekutif

Phase 3 menambahkan jalur pembayaran: tenant FREE bisa bayar **Rp99.000/bulan** untuk
mengaktifkan PRO, tenant PRO di-re-bill otomatis tiap bulan, dan tenant yang telat bayar
di-downgrade ke FREE setelah **grace period 3 hari**.

Keputusan kunci (hasil evaluasi open item #5):

| Keputusan | Pilihan | Alasan singkat |
|---|---|---|
| Produk Xendit | **Invoice API (legacy v2)** | Paling simple: 1 endpoint create → hosted page QRIS/VA/e-wallet/card. Expiry built-in (`invoice_duration`) cocok dgn model grace period. Fee per-channel identik dgn API lain (fee = per produk payment channel, bukan per API version). |
| Recurring | ❌ Ditolak | Wajib kartu (2.9%+Rp2.000, token + 3DS), pasar ID mayoritas non-kartu, effort jauh lebih tinggi. |
| Model re-bill | **Manual re-bill via cron bulanan** | Cron harian cek tenant PRO yg periodenya habis → create invoice baru. Tanpa auto-debit (butuh kartu), tanpa subscription engine. |
| Grace period | **3 hari** | PRO tetap aktif selama grace; downgrade FREE setelah `planExpiresAt + 3 hari` tanpa pembayaran. |
| Cron host | **GitHub Actions** (bukan Vercel Cron) | Vercel Hobby **tidak** support Cron Jobs (fitur Pro $20/bln). GH Actions gratis. Catatan: ganti ke Vercel Cron kalau naik Vercel Pro. |
| Tenant demo (kopi-makassar, kopi-senja) | **Rekomendasi: PRO permanen** | Set `plan=PRO, planExpiresAt=NULL` sekali di DB prod (bukan migration). `planExpiresAt=NULL` = "tidak pernah expire" → cron re-bill otomatis skip. |

Estimasi total: **2–3 hari kerja pioneer** (5 task utama + testing). Detail §12.

---

## 2. Keputusan PM (fixed, tidak bisa diubah)

1. Gateway: **Xendit** (bukan Midtrans).
2. Harga PRO: **Rp99.000/bulan** (note: proposal lama Rp49rb — harga baru ini yg dipakai).
3. Tenant existing = **demo**: boleh diabaikan/dihapus; rekomendasi §11.
4. Semua tenant baru default **FREE** (sudah berlaku — `Tenant.plan @default(FREE)`).

---

## 3. Open item #5 — Pilihan billing model Xendit (diputuskan @senior)

### 3.1 Perbandingan opsi

| Aspek | **Invoice API (legacy v2)** ✅ | Payment Sessions / v3 `payment_requests` | Recurring / Subscription |
|---|---|---|---|
| Effort integrasi | **Paling rendah.** `POST /v2/invoices` → dapat `invoice_url` → redirect. Webhook `invoice.paid`/`invoice.expired`. | Sedikit lebih tinggi: flow session lifecycle, `success/failure_return_url`, event `payment.capture`. | **Tinggi:** tokenisasi kartu, 3DS2, retry logic, `subscription_cycle`. |
| Channel pembayaran | QRIS, VA, e-wallet, OTC, kartu (hosted page) | Sama (QRIS, VA, e-wallet, kartu) | **Hanya kartu** |
| Expiry built-in | ✅ `invoice_duration` (jam) | Ada session expiry, tapi semantics beda | ❌ |
| Fee transaksi | Per-channel (lihat §3.2) — **sama** untuk semua API version | Sama | Kartu 2.9% + Rp2.000 |
| Risiko legacy | ⚠️ Legacy — Xendit dorong migrasi ke Payment Session; kebijakan pricing menyebut *Maintenance Fee* utk legacy API (besar tidak dipublikasikan, tergantung kontrak; praktis baru berlaku kalau Xendit paksa migrasi massal). | Rendah (produk current) | Rendah (produk current) |
| Cocok pasar ID (non-kartu) | ✅ | ✅ | ❌ |

### 3.2 Fee aktual (snapshot halaman pricing Xendit ID, 2026-08-20)

Fee Xendit = **Payment Method Fee + Xendit Processing Fee**, dikenakan **per transaksi sukses** (gagal/expired gratis).

| Channel | Payment Method Fee | Processing Fee | Total utk invoice Rp99.000 |
|---|---|---|---|
| **QRIS** | 0.70% (incl. VAT) | Rp4.000 | **±Rp4.693** (4.7%) |
| E-wallet (DANA/OVO/ShopeePay/GoPay) | ±2% (lihat dashboard) | Rp4.000 | **±Rp6.000** (6%) |
| Virtual Account (BCA/BNI/BRI/Mandiri/BSI/CIMB/Permata dll) | **Rp9.000 flat** | Rp4.000 | **Rp13.000** (13%) |
| OTC (Alfamart/Indomaret) | Rp9.000 flat | Rp4.000 | Rp13.000 |
| Kartu kredit | ±2.9% | Rp2.000 | ±Rp4.871 |
| Debit BRI | 1.90% | Rp4.000 | ±Rp5.881 |

Catatan penting:
- **Min Monthly Fee USD 50** — kalau total fee bulanan < ±Rp800rb, Xendit menagih selisihnya. Dengan Rp99rb/tenant, fee QRIS ±Rp4.7rb → butuh ±170 pembayaran/bulan utk lewat ambang. Ini **beban platform, bukan tenant** — catat sebagai risiko biaya (§13), jangan di-pass ke harga tenant.
- Tenant paling mungkin pakai **QRIS** (pasar ID, tanpa kartu) → rata-rata fee ±Rp5–7rb/transaksi. Margin bersih per pembayaran ±Rp92–94rb.

### 3.3 Keputusan

**Gunakan Xendit Invoice API (legacy v2).** Justifikasi: effort paling rendah (1 create call + 1 webhook + redirect), expiry bawaan (`invoice_duration`) persis kebutuhan grace period, dan fee per-transaksi identik antar API version. Risiko legacy dimitigasi: isolasi semua call Xendit di satu modul (`lib/xendit.ts`) sehingga migrasi ke Payment Sessions nanti = ganti 1 file + nama event webhook (dijadwalkan sebagai follow-up, out of scope Phase 3).

---

## 4. Alur (sequence)

### 4.1 Upgrade pertama (FREE → PRO)

```
Tenant (admin settings)                        App (Next.js)                       Xendit
        │  klik "Bayar Rp99.000"                    │                                │
        │─────────────────────────────────────────>│ POST /api/billing/upgrade      │
        │                                          │ 1. create Payment PENDING      │
        │                                          │    (externalId=pay_<tenantId>_<periodStart>) │
        │                                          │ 2. POST /v2/invoices            │
        │                                          │    { external_id, amount: 99000, │
        │                                          │      invoice_duration: 72,     │
        │                                          │      success_redirect_url,     │
        │                                          │      customer_email }          │
        │                                          │<───────────────────────────────│ 201 invoice_url
        │                                          │ 3. simpan xenditInvoiceId, invoiceUrl
        │  <─ 303 redirect ke invoice_url ─────────│                                │
        │  (hosted page: QRIS/VA/e-wallet/card)    │                                │
        │  bayar…                                  │                                │
        │                                          │<── webhook invoice.paid ───────│
        │                                          │ 1. verify x-callback-token     │
        │                                          │ 2. idempotency check           │
        │                                          │ 3. verify amount == 99000      │
        │                                          │ 4. update Payment → PAID       │
        │                                          │    Tenant.plan=PRO,            │
        │                                          │    planExpiresAt=now+30 hari   │
        │  <─ success_redirect_url ────────────────│                                │
```

### 4.2 Re-bill bulanan (PRO → PRO)

```
Cron harian (GitHub Actions → POST /api/cron/rebill, header x-cron-secret)
  → tenant PRO dgn planExpiresAt != null
    → kalau planExpiresAt <= now+24h ATAU sudah lewat (dalam grace 3 hari)
      DAN belum ada Payment PENDING utk periode berikutnya
        → create invoice baru (flow sama spt 4.1 langkah 2–3)
  → invoice.paid webhook → planExpiresAt += 30 hari (bukan reset ke now+30 —
    periode berkesinambungan: planExpiresAt = max(planExpiresAt, now) + 30d)
```

### 4.3 Grace period & auto-downgrade

```
planExpiresAt (akhir periode) ──► +3 hari (grace, PRO tetap aktif) ──► downgrade
   │                                     │                                  │
   │ cron create invoice utk periode     │ cron create invoice (masih       │
   │ baru (pay window terbuka)           │ boleh bayar selama grace)        │
   │                                     │ invoice.paid → planExpiresAt     │
   │                                     │   = max(planExpiresAt, now)+30d  │
   │                                     └─ tidak dibayar sampai batas       │
   │                                        → cron set plan=FREE,            │
   │                                          planExpiresAt=null             │
```

Detail boundary (wajib di-test):
- `now == planExpiresAt` → grace dimulai (masih PRO).
- `now == planExpiresAt + 3 hari` → downgrade (TEPAT di boundary downgrade, bukan setelahnya).
- `planExpiresAt = null` (demo PRO permanen) → cron **skip** (tidak pernah re-bill/downgrade).

---

## 5. Schema & migration

```prisma
// File: prisma/schema.prisma — tambah model + enum (setelah model Customer)

enum PaymentStatus {
  PENDING
  PAID
  EXPIRED
}

model Payment {
  id               String        @id @default(uuid()) @db.Uuid
  tenantId         String        @db.Uuid
  tenant           Tenant        @relation(fields: [tenantId], references: [id])
  xenditInvoiceId  String?       @unique // set setelah create invoice sukses
  externalId       String        @unique // kunci idempotency: pay_<tenantId>_<periodStart ISO>
  amount           Decimal       @db.Decimal(12, 2) // selalu 99000 (validasi webhook)
  periodStart      DateTime      // awal periode 30 hari yg dibayar
  periodEnd        DateTime      // periodStart + 30 hari
  status           PaymentStatus @default(PENDING)
  paidAt           DateTime?
  paymentMethod    String?       // channel yg dipakai customer (qris, bca_va, dst)
  invoiceUrl       String?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@index([tenantId, status])
  @@index([tenantId, periodStart])
}
```

- `Tenant.plan`, `Tenant.planExpiresAt` — **tidak berubah**. Tetap satu-satunya sumber kebenaran status PRO.
- Migration: `npx prisma migrate dev --name add_payment` → hasil deploy via `prisma migrate deploy` (sudah ada di `vercel.json` buildCommand).
- Tidak ada backfill (Payment kosong di awal; tenant demo di-handle manual §11).

---

## 6. Integrasi Xendit

### 6.1 Env vars (server-only, di Vercel env; `.env.example` utk lokal)

```
XENDIT_SECRET_KEY=        # API key (create invoice, server-side)
XENDIT_WEBHOOK_TOKEN=     # token dari Dashboard → Settings → Webhooks (utk verifikasi x-callback-token)
XENDIT_BASE_URL=https://api.xendit.co   # test: https://api.xendit.co (pakai xnd_development_ key)
CRON_SECRET=              # token utk /api/cron/rebill (dari GitHub Actions)
NEXT_PUBLIC_APP_URL=      # utk success_redirect_url
```

**Aturan:** tidak ada secret di code/client. `NEXT_PUBLIC_*` hanya `NEXT_PUBLIC_APP_URL` (bukan secret).

### 6.2 Modul `src/lib/xendit.ts` (semua call Xendit terisolasi di sini)

```ts
// createInvoice(input): POST {XENDIT_BASE_URL}/v2/invoices
//   headers: Authorization: Basic base64(XENDIT_SECRET_KEY + ":"), Content-Type: application/json
//   body: {
//     external_id,            // = Payment.externalId (pay_<tenantId>_<periodStart>)
//     amount: 99000,
//     description: "HeadwayBrew PRO — langganan 30 hari (periodStart s/d periodEnd)",
//     invoice_duration: 72,  // jam — pay window = grace period 3 hari
//     success_redirect_url: `${NEXT_PUBLIC_APP_URL}/admin/<slug>/settings?billing=success`,
//     currency: "IDR",
//     customer: { email: tenant.contactEmail ?? undefined },  // opsional
//   }
//   → { id, invoice_url, status }
//   error mapping: 400/401/429 → throw XenditError { status, code, message }
// verifyWebhookToken(headerValue): boolean  // crypto.timingSafeEqual, constant-time
```

Catatan:
- `invoice_duration: 72` → invoice expired otomatis di Xendit 3 hari setelah create → sinkron dgn grace period. Event `invoice.expired` menandai Payment → EXPIRED (opsional; downgrade tetap ditangani cron).
- `external_id` = kunci idempotency. Xendit menolak external_id duplikat → create ganda dari cron/retry aman.

### 6.3 Webhook `POST /api/webhooks/xendit`

1. **Verifikasi signature:** baca header `x-callback-token`, bandingkan constant-time dgn `XENDIT_WEBHOOK_TOKEN`. Gagal → 401. (Referensi resmi: docs.xendit.co/handling-webhooks — "Xendit can sign each webhook event... by including a token in each event's x-callback-token header").
2. **Rate limit** per-IP (pakai `src/lib/rate-limit.ts` — tambah `"POST /api/webhooks/xendit": { windowMs: 60_000, max: 30 }`) sebagai defense-in-depth.
3. **Event routing** (payload `{ id, external_id, status, amount, paid_at, payment_method, ... }`):
   - `invoice.paid` → handlePaid
   - `invoice.expired` → mark Payment EXPIRED (no-op kalau sudah PAID)
   - lainnya → 200 (abaikan)
4. **handlePaid (idempotent):**
   a. Cari Payment by `xenditInvoiceId` (atau `externalId`).
   b. Sudah PAID? → return 200 (duplicate delivery — Xendit retry s/d 6x exponential backoff, duplikat dijamin terjadi).
   c. **Validasi amount:** `webhook.amount < Payment.amount` → jangan aktivasi; log + alert (underpayment attack/error). Return 200 (jangan trigger retry) + simpan status.
   d. Update atomik: `Payment → PAID (paidAt, paymentMethod)` **dan** `Tenant → plan=PRO, planExpiresAt = max(planExpiresAt ?? now, now) + 30 hari` (satu transaksi Prisma `$transaction`).
5. **Respons cepat:** return 200 secepatnya (Xendit timeout → retry). Jangan kerja berat sinkron.

### 6.4 Idempotency ringkasan

| Lapisan | Mekanisme |
|---|---|
| Create invoice | `externalId` unik (unique constraint DB + Xendit reject duplikat) |
| Webhook delivery ganda | `Payment.xenditInvoiceId @unique` + cek status PAID sebelum proses |
| Cron re-bill ganda (overlap run) | Cek "sudah ada Payment PENDING utk periode" sebelum create |
| Retry cron (GH Actions re-run) | Idem — create invoice yg sama ditolak Xendit |

---

## 7. Cron re-bill + auto-downgrade

### 7.1 Kenapa GitHub Actions, bukan Vercel Cron

**Vercel Cron = fitur Pro ($20/bln).** Proyek saat ini Vercel Hobby (free). Solusi tanpa biaya:

`.github/workflows/rebill.yml`:
```yaml
name: rebill
on:
  schedule:
    - cron: "0 1 * * *"   # 01:00 UTC harian (pakai UTC, konsisten dgn kodebase)
  workflow_dispatch: {}   # manual trigger utk testing
jobs:
  rebill:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "${{ secrets.APP_URL }}/api/cron/rebill" \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}"
```

Note: kalau tim nanti upgrade Vercel Pro → pindah ke `vercel.json` `crons` (config 1 blok, handler sama).

### 7.2 Handler `POST /api/cron/rebill` (auth: header `x-cron-secret` == `CRON_SECRET`, constant-time)

Satu pass, idempotent:
1. Ambil tenant: `plan=PRO, planExpiresAt != null`.
2. Utk tiap tenant:
   - **Downgrade check:** `planExpiresAt + 3 hari < now` → `plan=FREE, planExpiresAt=null` (log).
   - **Re-bill check:** `planExpiresAt <= now + 24h` (pay window buka 24 jam sebelum habis) DAN belum ada `Payment PENDING` utk periode berikutnya → create invoice (alur §6.2).
3. Error per-tenant di-catch terpisah (satu tenant gagal ≠ seluruh run gagal); log error, lanjut tenant lain.
4. Response: ringkasan `{ checked, invoiced, downgraded, errors }`.

### 7.3 Boundary grace (spec test)

- `planExpiresAt + 3d < now` → downgrade. **Tepat** di `==` → belum downgrade.
- Window re-bill: `planExpiresAt - 24h <= now`.
- `planExpiresAt == null` → skip total.

---

## 8. UI

### 8.1 Pricing page `src/app/pricing/page.tsx` (public, tambah ke nav landing)

- Harga **Rp99.000/bulan**, benefit PRO (menu tanpa batas, order tanpa batas, antrean s/d 100, retensi sprint 30 hari, tanpa badge, prioritas support).
- CTA "Upgrade sekarang" → kalau ada session admin → redirect ke `/admin/<slug>/settings?billing=1`; tanpa session → `/login` (lalu ke settings).
- Style ikut design system shadcn yg sudah ada (referensi landing page).

### 8.2 Admin settings — section Billing (`src/app/admin/[tenantSlug]/settings/page.tsx` + `src/components/admin/BillingCard.tsx`)

- **Status badge:** `FREE` (abu) / `PRO` (amber) + "aktif s/d <tanggal>" kalau PRO.
- FREE tenant: tombol **"Bayar Rp99.000"** → `POST /api/billing/upgrade` → 303 ke `invoice_url` (atau return `{ invoiceUrl }` → `window.location`).
- PRO tenant dlm grace (planExpiresAt < now tapi belum di-downgrade): banner "Langganan berakhir — bayar tagihan utk lanjut" + tombol bayar (invoice PENDING sudah dibuat cron; tombol = re-fetch invoiceUrl atau create baru kalau belum ada).
- PRO aktif: teks "Otomatis diperpanjang tiap bulan" + tanggal expire.
- Data dari `GET /api/admin/settings` (sudah return `plan`, `planExpiresAt`) + endpoint baru `GET /api/billing/status` (list Payment terakhir: status, periode, metode, tanggal) — atau extend settings response dgn `latestPayment`.

### 8.3 Route baru ringkasan

| Route | Method | Auth | Fungsi |
|---|---|---|---|
| `/api/billing/upgrade` | POST | admin session | Create Payment PENDING + invoice Xendit → return `{ invoiceUrl }` |
| `/api/billing/status` | GET | admin session | Status plan + riwayat Payment terakhir |
| `/api/webhooks/xendit` | POST | x-callback-token | Terima event invoice.paid/expired |
| `/api/cron/rebill` | POST | x-cron-secret | Re-bill + downgrade bulanan |
| `/pricing` | GET | public | Halaman harga |

---

## 9. Keamanan

1. **Webhook signature:** `x-callback-token` + `crypto.timingSafeEqual` (constant-time). Gagal → 401, tanpa proses apa pun.
2. **Idempotency** (unique `externalId`, cek status PAID, cek Payment PENDING sebelum create) — mencegah double-charge & double-activation.
3. **Validasi amount** di webhook: aktivasi hanya kalau `webhook.amount >= Payment.amount` (99000). Underpayment tidak mengaktifkan PRO.
4. **Tidak ada secret di code:** semua via env var; `lib/xendit.ts` satu-satunya tempat akses `XENDIT_SECRET_KEY`; client bundle tidak pernah menerima secret (hanya `invoiceUrl`).
5. **Cron auth:** header `x-cron-secret` (constant-time) — endpoint tidak boleh terbuka publik.
6. **Rate limit** webhook & cron (defense-in-depth; signature tetap otoritas utama).
7. **Read-only plan fields** tetap dijaga: settings PATCH sudah menolak `plan`/`planExpiresAt` (READONLY_FIELDS) — hanya webhook (verify token) & cron (verify secret) yang boleh menulis.
8. **CSP:** redirect ke Xendit = top-level navigation, bukan fetch — tidak perlu ubah `connect-src`.

---

## 10. Testing strategy

Stack: vitest (unit + integration dgn DB test seperti `tests/helpers.ts` — `setupTenant` sudah dukung `plan`).

| Area | Test | Cara mock |
|---|---|---|
| `lib/xendit.ts` | createInvoice: payload benar, error 400/401/429 mapping, `invoice_duration=72` | `vi.stubGlobal("fetch", ...)` — tanpa network |
| Signature | valid token → pass; salah token → reject; token kosong/malformed → reject | unit murni |
| Webhook paid | Payment PENDING → PAID + `plan=PRO, planExpiresAt=now+30d`; amount < 99000 → **tidak** aktivasi; duplikat delivery → 200 no-op; tenant tidak ada → 404/200+log | integration dgn DB + fetch mock |
| Webhook expired | PENDING → EXPIRED; PAID → no-op | integration |
| Cron re-bill | tenant `planExpiresAt <= now+24h` & tanpa Payment PENDING → create invoice (fetch mock, cek payload `external_id`); `planExpiresAt=null` → skip; tenant baru FREE → skip | integration dgn DB |
| Cron downgrade | boundary `planExpiresAt+3d < now` → FREE; `==` → belum; sudah PAID periode baru → tidak di-downgrade | integration dgn DB |
| Billing upgrade route | no session → 401; sukses → Payment PENDING + `{ invoiceUrl }`; Xendit error → Payment EXPIRED/FAILED + 502 | integration |
| Pricing page | render harga 99.000 + benefit; CTA routing | component test (pola `*.test.tsx` existing) |
| BillingCard | badge FREE/PRO, tombol bayar, status grace | component test dgn fetch mock `fetchSettings` |

**E2E manual (staging):** pakai **Xendit test mode** (`xnd_development_` key) → create invoice → dashboard Xendit → "Simulate payment" → webhook masuk → cek tenant jadi PRO. Uji juga flow QRIS test.

---

## 11. Demo tenants (kopi-makassar, kopi-senja) — rekomendasi

**Rekomendasi: jangan dihapus, jadikan PRO permanen** (demo & showcase tetap jalan tanpa gate).

```sql
-- JALANKAN MANUAL di DB prod (bukan migration, bukan seed)
UPDATE "Tenant" SET "plan" = 'PRO', "planExpiresAt" = NULL
WHERE "slug" IN ('kopi-makassar', 'kopi-senja');
```

- `planExpiresAt = NULL` → cron re-bill & downgrade otomatis skip (spec §7.3).
- Kalau PM lebih suka tenant demo bebas semua (termasuk di luar fitur PRO), hapus dari DB prod manual — tapi rekomendasi tetap PRO permanen (data operasional nyata berguna utk demo).

---

## 12. Task breakdown utk pioneer + estimasi

Total: **±2–3 hari**. Urutan wajib (dependency): T13 → T14 → T15/T16 → T17 → T18/T19 → T20.

| # | Task | File utama | Estimasi |
|---|---|---|---|
| T13 | Schema: model `Payment` + enum `PaymentStatus` + migration | `prisma/schema.prisma`, migration baru | 0.5 jam |
| T14 | `lib/xendit.ts`: createInvoice + verifyWebhookToken + XenditError; env vars + `.env.example` | `src/lib/xendit.ts` | 1.5 jam |
| T15 | `POST /api/billing/upgrade` + `GET /api/billing/status` (admin session, Payment PENDING, redirect url) | `src/app/api/billing/*` | 2 jam |
| T16 | `POST /api/webhooks/xendit`: signature verify, event routing, handlePaid idempotent + $transaction, validasi amount | `src/app/api/webhooks/xendit/route.ts` | 3 jam |
| T17 | `POST /api/cron/rebill` + `.github/workflows/rebill.yml` + CRON_SECRET; grace boundary | `src/app/api/cron/rebill/route.ts` | 3 jam |
| T18 | Admin BillingCard + badge status + tombol bayar + status grace | `src/components/admin/BillingCard.tsx`, settings page | 3 jam |
| T19 | Pricing page `/pricing` + nav link | `src/app/pricing/page.tsx` | 2 jam |
| T20 | Tests (unit + integration §10) + SQL demo tenant + docs | `tests/billing-*.test.ts` | 3–4 jam |

**Kriteria selesai:** semua test pass (`npm test`), `npx tsc --noEmit` 0 error, `npm run build` OK, flow manual test-mode Xendit tervalidasi di staging (webhook → PRO aktif).

---

## 13. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Min Monthly Fee USD 50 Xendit** | Beban ±Rp800rb/bln kalau volume kecil | Catat sbg biaya platform; evaluasi volume sebelum scale; jangan di-pass ke harga |
| VA/OTC fee Rp13.000 (13%) | Margin tipis kalau tenant pilih VA | QRIS default termurah (4.7%); pricing page bisa highlight QRIS; evaluasi naikkan harga kalau mix channel berat |
| Invoice API legacy (maintenance fee/deprecation) | Biaya/migrasi mendadak | Isolasi di `lib/xendit.ts`; follow-up migrasi ke Payment Sessions terjadwal |
| Webhook ganda/retry (Xendit retry 6x) | Double activation | Idempotency layer §6.4 |
| Webhook palsu | Tenant PRO gratis | Signature verify + amount validation + rate limit |
| Vercel Hobby tanpa cron | Re-bill tidak jalan | GitHub Actions (gratis) — §7.1 |
| Tenant lupa bayar → downgrade | Churn | Grace 3 hari + banner di admin + email reminder (opsional, out of scope) |
| `planExpiresAt` drift (UTC vs tz lokal) | Downgrade salah waktu | Semua logika UTC (konsisten dgn kodebase "all UTC"); boundary pakai timestamp UTC murni |

---

## 14. Out of scope (eksplisit)

- Self-serve cancel/refund tenant (manual via dashboard Xendit / SQL).
- Multi-admin billing, role per-admin.
- Custom domain.
- Annual plan / diskon / promo.
- Auto-debit / kartu tersimpan (butuh Recurring — ditolak).
- Email notification engine (reminder tagihan) — cukup banner in-app.
- Migrasi ke Payment Sessions v3 (follow-up terpisah).
- Pajak/invoice legal formal (saat revenue konsisten).

---

## 15. Referensi & sumber

- Xendit docs — Handling webhooks (x-callback-token, retry 6x, duplicate webhooks): https://docs.xendit.co/v1/docs/handling-webhooks
- Xendit docs — Transaction fees (Payment Method Fee + Processing Fee, Min Monthly Fee USD 50, Maintenance Fee legacy API): https://docs.xendit.co/v1/docs/transaction-fees
- Xendit docs — How Payments API work (v3 migration note): https://docs.xendit.co/v1/docs/how-payments-api-work
- Xendit pricing ID (snapshot fee 2026-08-20, halaman interaktif): https://www.xendit.co/en-id/pricing/
- Xendit Invoice API reference (legacy v2 create invoice): https://developers.xendit.co/api-reference/#create-invoice
- Kodebase: `prisma/schema.prisma` (model Tenant plan/planExpiresAt), `src/lib/plan.ts` (PLAN_FEATURES), `src/app/api/admin/settings/route.ts` (READONLY_FIELDS), `src/lib/rate-limit.ts`, `tests/helpers.ts` (setupTenant).
