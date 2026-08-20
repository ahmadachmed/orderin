# Monetization Phase 3 — Duitku Billing + Pricing Rp99.000

**Status:** Plan aktif — T13–T20 (Xendit) SUDAH diimplementasi & merged (12b76b7, PR #258). **T21: swap lapisan integrasi Xendit → Duitku** belum dikerjakan.
**Owner:** @senior · **Date:** 2026-08-20 (update: gateway Xendit → Duitku, keputusan PM + user)
**Gate:** Phase 0+1 (issue #229) sudah merged — tier FREE/PRO, feature gates, badge, upsell banner.
**Yang belum ada:** mekanisme tenant **BAYAR → upgrade ke PRO** yang live dengan gateway final (Duitku).

---

## 1. Ringkasan eksekutif

Phase 3 menambahkan jalur pembayaran: tenant FREE bisa bayar **Rp99.000/bulan** untuk
mengaktifkan PRO, tenant PRO di-re-bill otomatis tiap bulan, dan tenant yang telat bayar
di-downgrade ke FREE setelah **grace period 3 hari**.

**Keputusan kunci (2026-08-20):** gateway di-switch dari Xendit → **Duitku** (keputusan PM + user).
T13–T20 yang sudah keimplementasi pakai Xendit tetap di-merge (PR #258, 12b76b7) karena
schema/pricing/billing-card/badge bersifat **gateway-agnostic**; yang gateway-specific hanya
lapisan integrasi (`lib/xendit.ts`, webhook route, cron re-bill) → diganti di **T21** dengan
Duitku Pop (createInvoice → paymentUrl → callback HMAC SHA256).

| Keputusan | Pilihan | Alasan singkat |
|---|---|---|
| Produk Duitku | **Pop (hosted payment page)** | Paling simple: 1 endpoint create → `paymentUrl` hosted page (QRIS/VA/e-wallet). Mirip Xendit Invoice. Sandbox tersedia. |
| Recurring | ❌ Ditolak | Tetap tidak cocok pasar ID (butuh kartu / akun OVO/ShopeePay ter-tokenize). Model re-bill manual via cron tetap. |
| Model re-bill | **Manual re-bill via cron bulanan** | Tidak berubah dari keputusan awal: cron harian cek tenant PRO yg periodenya habis → create invoice baru. |
| Grace period | **3 hari** | PRO tetap aktif selama grace; downgrade FREE setelah `planExpiresAt + 3 hari` tanpa pembayaran. |
| Cron host | **GitHub Actions** (bukan Vercel Cron) | Vercel Hobby tidak support Cron Jobs. GH Actions gratis. |
| Tenant demo (kopi-makassar, kopi-senja) | **Rekomendasi: PRO permanen** | `plan=PRO, planExpiresAt=NULL` sekali di DB prod → cron re-bill/downgrade auto skip. |

Estimasi T21: **±1–2 hari kerja pioneer** (swap lapisan integrasi saja). Detail §12.

---

## 2. Keputusan PM (fixed, tidak bisa diubah)

1. Gateway: **Duitku** (bukan Midtrans, bukan Xendit) — keputusan PM + user 2026-08-20.
2. Harga PRO: **Rp99.000/bulan**.
3. Tenant existing = **demo**: rekomendasi §11 (PRO permanen).
4. Semua tenant baru default **FREE** (sudah berlaku — `Tenant.plan @default(FREE)`).

---

## 3. Pilihan billing model Duitku (diputuskan @senior)

### 3.1 Perbandingan opsi

| Aspek | **Duitku Pop (hosted page)** ✅ | Duitku Checkout / direct API per-channel | Recurring / tokenisasi |
|---|---|---|---|
| Effort integrasi | **Paling rendah.** 1 call `createInvoice` → dapat `paymentUrl` → redirect. Callback tunggal (form POST). | Sedikit lebih tinggi: pilih channel per tenant, handle status per channel. | **Tinggi:** tokenisasi akun, retry logic. |
| Channel pembayaran | QRIS, VA, e-wallet, retail, kartu (hosted page, semua channel Duitku) | Sama, tapi diset per transaksi | Terbatas |
| Expiry | `expiryPeriod` (menit) per transaksi — channel-dependent max (VA/retail >1440, e-wallet lebih rendah) | Sama | ❌ |
| Fee transaksi | Per-channel (lihat §3.2) | Sama | Lebih tinggi |
| Risiko | Rendah (produk current, docs aktif docs.duitku.com) | Rendah | Tinggi (churn akun) |
| Cocok pasar ID (non-kartu) | ✅ | ✅ | ❌ |

### 3.2 Fee Duitku (verifikasi PM 2026-08-20, sumber resmi)

| Channel | Fee | Catatan |
|---|---|---|
| **QRIS** | **0,7%** | Setara Xendit (0,7%+Rp4.000 → Duitku lebih murah: tanpa biaya tetap Rp4.000) |
| **Virtual Account** | **Rp1.500–5.000** (per channel bank) | Jauh di bawah Xendit (Rp9.000+4.000 = Rp13.000) |
| **E-wallet** (DANA/OVO/ShopeePay/dll) | **2–4%** | Sebanding Xendit (~2%+Rp4.000) |
| **Minimal monthly fee** | **TIDAK ADA** | Beda kunci vs Xendit (USD 50/bln). Tidak ada beban platform bulanan. |
| Volume besar | Harga khusus kalau volume > **Rp500jt/bulan** | Negosiasi langsung dengan Duitku; catat sebagai risiko §13, bukan biaya tetap. |

Catatan: dengan Rp99rb/tenant, fee QRIS ±Rp693 (vs Xendit ±Rp4.693) → margin bersih per
pembayaran naik jadi ±Rp98rb. Ini keunggulan kompetitif Duitku di keputusan swap.

### 3.3 Keputusan

**Gunakan Duitku Pop** — `POST /api/merchant/createInvoice` → `paymentUrl` (hosted page).
Justifikasi: effort paling rendah (1 create call + 1 callback handler + redirect), docs aktif,
sandbox tersedia, fee lebih murah, tanpa minimum monthly fee. Isolasi semua call Duitku di satu
modul (`src/lib/duitku.ts`) — kalau nanti ganti gateway lagi = ganti 1 modul + webhook route.

---

## 4. Alur (sequence)

### 4.1 Upgrade pertama (FREE → PRO)

```
Tenant (admin settings)                        App (Next.js)                       Duitku
        │  klik "Bayar Rp99.000"                    │                                │
        │─────────────────────────────────────────>│ POST /api/billing/upgrade      │
        │                                          │ 1. create Payment PENDING      │
        │                                          │    (externalId=pay_<tenantId>_<periodStart>) │
        │                                          │ 2. POST /api/merchant/createInvoice
        │                                          │    headers: x-duitku-merchantcode,
        │                                          │             x-duitku-timestamp (ms, WIB),
        │                                          │             x-duitku-signature
        │                                          │             (HMAC-SHA256(merchantCode+timestamp, apiKey))
        │                                          │    body: { paymentAmount: 99000,
        │                                          │      merchantOrderId: externalId,
        │                                          │      productDetails, callbackUrl,
        │                                          │      returnUrl, expiryPeriod, email, ... }
        │                                          │<───────────────────────────────│ paymentUrl, reference
        │                                          │ 3. simpan duitkuReference, invoiceUrl
        │  <─ 303 redirect ke paymentUrl ──────────│                                │
        │  (hosted page Duitku: QRIS/VA/e-wallet)  │                                │
        │  bayar…                                  │                                │
        │                                          │<── callback POST (form) ───────│
        │                                          │    merchantCode, amount, merchantOrderId,
        │                                          │    resultCode=00, reference, signature
        │                                          │ 1. verify signature:
        │                                          │    HMAC-SHA256(merchantCode+amount+merchantOrderId, apiKey)
        │                                          │ 2. idempotency check
        │                                          │ 3. resultCode==00 && amount >= 99000
        │                                          │ 4. update Payment → PAID
        │                                          │    Tenant.plan=PRO,
        │                                          │    planExpiresAt=now+30 hari
        │  <─ returnUrl (redirect) ────────────────│   (returnUrl = info saja, TIDAK dipercaya;
        │                                          │    aktivasi hanya via callback terverifikasi)
```

### 4.2 Re-bill bulanan (PRO → PRO)

```
Cron harian (GitHub Actions → POST /api/cron/rebill, header x-cron-secret)
  → tenant PRO dgn planExpiresAt != null
    → kalau planExpiresAt <= now+24h ATAU sudah lewat (dalam grace 3 hari)
      DAN belum ada Payment PENDING utk periode berikutnya
        → create invoice baru (flow sama spt 4.1 langkah 2–3)
  → callback resultCode=00 → planExpiresAt = max(planExpiresAt, now) + 30d
    (periode berkesinambungan, bukan reset ke now+30)
```

### 4.3 Grace period & auto-downgrade

```
planExpiresAt (akhir periode) ──► +3 hari (grace, PRO tetap aktif) ──► downgrade
   │                                     │                                  │
   │ cron create invoice utk periode     │ cron create invoice (masih       │
   │ baru (pay window terbuka)           │ boleh bayar selama grace)        │
   │                                     │ callback resultCode=00 →         │
   │                                     │   planExpiresAt = max(...,now)+30d
   │                                     └─ tidak dibayar sampai batas       │
   │                                        → cron set plan=FREE,            │
   │                                          planExpiresAt=null             │
```

Detail boundary (wajib di-test):
- `now == planExpiresAt` → grace dimulai (masih PRO).
- `now == planExpiresAt + 3 hari` → downgrade (TEPAT di boundary downgrade, bukan setelahnya).
- `planExpiresAt = null` (demo PRO permanen) → cron **skip**.
- Catatan expiry Duitku: `expiryPeriod` per-channel (VA/retail bisa >1440 menit; e-wallet cap
  lebih rendah: ShopeePay 60 menit, OVO/DANA 1440 menit). Grace/downgrade **tetap ditangani
  cron** (sumber kebenaran = `planExpiresAt`), expiry invoice Duitku hanya pembatas teknis.

---

## 5. Schema & migration

```prisma
// File: prisma/schema.prisma — SUDAH diimplementasikan (T13, merged 12b76b7)
enum PaymentStatus {   // nama aktual di kode: BillingPaymentStatus
  PENDING
  PAID
  EXPIRED
}

model Payment {
  id              String               @id @default(uuid()) @db.Uuid
  tenantId        String               @db.Uuid
  tenant          Tenant               @relation(fields: [tenantId], references: [id])
  xenditInvoiceId String?              @unique // ⚠️ gateway-specific — lihat catatan T21
  externalId      String               @unique // idempotency key: pay_<tenantId>_<periodStart epochMs>
  amount          Decimal              @db.Decimal(12, 2) // selalu 99000 — callback memvalidasi ini
  periodStart     DateTime             // awal periode 30 hari yg dibayar
  periodEnd       DateTime             // periodStart + 30 hari
  status          BillingPaymentStatus @default(PENDING)
  paidAt          DateTime?
  paymentMethod   String?              // channel yg dipakai customer (qris, bca_va, ...)
  invoiceUrl      String?
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  @@index([tenantId, status])
  @@index([tenantId, periodStart])
}
```

- `Tenant.plan`, `Tenant.planExpiresAt` — **tidak berubah**. Satu-satunya sumber kebenaran status PRO.
- **Catatan T21 (rekomendasi @senior):** field `xenditInvoiceId` (nama Xendit-specific) dan komentar
  schema "gateway-agnostic" bertentangan. Rekomendasi: rename field → `gatewayReference String? @unique`
  (migration rename sederhana, tanpa perubahan struktur/relasi). Struktur model TIDAK berubah — hanya
  nama field. Kalau lead/pioneer setuju, masuk ke T21; kalau tidak, biarkan dan dokumentasikan sebagai
  tech-debt kecil.
- Tidak ada backfill (Payment kosong di awal; tenant demo di-handle manual §11).

---

## 6. Integrasi Duitku

### 6.1 Env vars (server-only, di Vercel env; `.env.example` utk lokal)

```env
DUITKU_MERCHANT_CODE=      # merchant code Duitku (dashboard Duitku, format DXXXX)
DUITKU_API_KEY=            # API key (signature createInvoice + verify callback)
DUITKU_BASE_URL=           # sandbox: https://api-sandbox.duitku.com/api/merchant/createInvoice
                           # prod:    https://api-prod.duitku.com/api/merchant/createInvoice
CRON_SECRET=               # token utk /api/cron/rebill (dari GitHub Actions)
NEXT_PUBLIC_APP_URL=       # utk callbackUrl + returnUrl
# opsional (defense-in-depth):
DUITKU_CALLBACK_IPS=       # whitelist IP callback Duitku (prod: 182.23.85.14, 103.177.101.190, ...)
```

**Aturan:** tidak ada secret di code/client. `NEXT_PUBLIC_*` hanya `NEXT_PUBLIC_APP_URL` (bukan secret).
Env XENDIT_* dihapus dari `.env.example` / Vercel setelah T21 selesai.

### 6.2 Modul `src/lib/duitku.ts` (pengganti `src/lib/xendit.ts` — semua call Duitku terisolasi di sini)

```ts
// createInvoice(input): POST {DUITKU_BASE_URL}
//   headers:
//     x-duitku-merchantcode: DUITKU_MERCHANT_CODE
//     x-duitku-timestamp:    Date.now() (UNIX ms, zona Jakarta/WIB — Duitku pakai WIB)
//     x-duitku-signature:    HMAC_SHA256(merchantCode + timestamp, DUITKU_API_KEY) — hex lowercase
//     Content-Type: application/json
//   body: {
//     paymentAmount: 99000,
//     merchantOrderId: input.externalId,   // = Payment.externalId — idempotency key
//     productDetails: "HeadwayBrew PRO — langganan 30 hari (periodStart s/d periodEnd)",
//     paymentMethod: "",                   // "" = semua channel (hosted page pilih channel)
//     customerVaName: <tenant name>, email: tenant.contactEmail ?? undefined,
//     callbackUrl: `${NEXT_PUBLIC_APP_URL}/api/webhooks/duitku`,
//     returnUrl: `${NEXT_PUBLIC_APP_URL}/admin/<slug>/settings?billing=success`,
//     expiryPeriod: 4320,                 // menit = 3 hari (pay window == grace; catat §4.3)
//   }
//   → { paymentUrl, reference, statusCode, statusMessage }
//   error mapping: non-200 / statusCode != "00" → throw DuitkuError { status, code, message }
// verifyCallbackSignature(merchantCode, amount, merchantOrderId, signature): boolean
//   // stringToSign = merchantCode + amount + merchantOrderId
//   // signature = HMAC_SHA256(stringToSign, DUITKU_API_KEY) — hex lowercase, compare constant-time
// verifyCronSecret(headerValue): boolean  // pindah dari xendit.ts, logika sama
```

Catatan:
- **DUA signature berbeda:** request `createInvoice` pakai header `x-duitku-signature`
  (merchantCode + timestamp), callback pakai body field `signature` (merchantCode + amount +
  merchantOrderId). Jangan tertukar.
- `timestamp` header: ms epoch **dalam zona Jakarta (UTC+7)**. Karena kodebase "all UTC",
  hitung eksplisit: `Date.now() + 7*3600_000` cukup utk tujuan signature (bukan utk tampilan).
- `merchantOrderId` harus unik & ≤ batas Duitku (docs tidak menyebut max; contoh resmi pendek).
  Format saat ini `pay_<uuid>_<epochMs>` ±60 char — **verifikasi ke Duitku / tes sandbox**; kalau
  ditolak, pakai format kompak: `pay_<tenantId.slice(0,8)>_<epochMs>` (tetap unik, idempotency
  tidak berubah karena `externalId` di DB tetap sumber kebenaran).

### 6.3 Webhook `POST /api/webhooks/duitku` (pengganti `/api/webhooks/xendit`)

Callback Duitku = **form POST** (`application/x-www-form-urlencoded`), bukan JSON.

1. **Verifikasi signature:** baca field `signature` dari form; hitung
   `HMAC_SHA256(merchantCode + amount + merchantOrderId, DUITKU_API_KEY)` (hex lowercase);
   bandingkan constant-time (`crypto.timingSafeEqual`). Gagal → 401.
2. **Rate limit** per-IP (pakai `src/lib/rate-limit.ts` — tambah `"POST /api/webhooks/duitku"`).
3. **IP whitelist (opsional, defense-in-depth):** kalau `DUITKU_CALLBACK_IPS` diset, cek IP
   pengirim (docs Duitku publish daftar IP prod & sandbox).
4. **Routing by `resultCode`:**
   - `resultCode == "00"` → handlePaid
   - lainnya (01 failed, dll) → mark Payment EXPIRED (no-op kalau sudah PAID)
5. **handlePaid (idempotent):**
   a. Cari Payment by `merchantOrderId` (= `Payment.externalId`) atau `reference` (= `gatewayReference`).
   b. Sudah PAID? → return 200 (duplicate delivery).
   c. **Validasi amount:** `callback.amount < Payment.amount` → jangan aktivasi; log + alert. Return 200.
   d. Update atomik: `Payment → PAID (paidAt, paymentMethod=paymentCode)` **dan**
      `Tenant → plan=PRO, planExpiresAt = max(planExpiresAt ?? now, now) + 30 hari`
      (satu transaksi Prisma `$transaction`).
6. **Respons cepat:** selalu balas **200 OK** (wajib Duitku — docs: "Return HTTP 200 OK"; selain itu
   dianggap gagal → retry).

### 6.4 Idempotency ringkasan

| Lapisan | Mekanisme |
|---|---|
| Create invoice | `merchantOrderId` unik (= `Payment.externalId` unique di DB; Duitku reject duplikat) |
| Callback delivery ganda | `Payment.gatewayReference @unique` + cek status PAID sebelum proses |
| Cron re-bill ganda (overlap run) | Cek "sudah ada Payment PENDING utk periode" sebelum create |
| Retry cron (GH Actions re-run) | Idem — create invoice yg sama ditolak Duitku |

---

## 7. Cron re-bill + auto-downgrade

### 7.1 Kenapa GitHub Actions, bukan Vercel Cron

**Tidak berubah dari keputusan awal** — Vercel Hobby tanpa Cron Jobs; GH Actions gratis:

`.github/workflows/rebill.yml` (sudah ada, T17) — **tidak perlu diubah** kecuali handler-nya:
```yaml
name: rebill
on:
  schedule:
    - cron: "0 1 * * *"   # 01:00 UTC harian
  workflow_dispatch: {}
jobs:
  rebill:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "${{ secrets.APP_URL }}/api/cron/rebill" \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}"
```

### 7.2 Handler `POST /api/cron/rebill` (auth: header `x-cron-secret` == `CRON_SECRET`, constant-time)

Logika **tidak berubah**; hanya call create-invoice yg ganti dari `lib/xendit.ts` → `lib/duitku.ts`:
1. Ambil tenant: `plan=PRO, planExpiresAt != null`.
2. Utk tiap tenant:
   - **Downgrade check:** `planExpiresAt + 3 hari < now` → `plan=FREE, planExpiresAt=null` (log).
   - **Re-bill check:** `planExpiresAt <= now + 24h` DAN belum ada `Payment PENDING` utk periode
     berikutnya → create invoice Duitku (alur §6.2).
3. Error per-tenant di-catch terpisah; log error, lanjut tenant lain.
4. Response: ringkasan `{ checked, invoiced, downgraded, errors }`.

### 7.3 Boundary grace (spec test)

- `planExpiresAt + 3d < now` → downgrade. **Tepat** di `==` → belum downgrade.
- Window re-bill: `planExpiresAt - 24h <= now`.
- `planExpiresAt == null` → skip total.

---

## 8. UI

**TIDAK BERUBAH (gateway-agnostic)** — BillingCard, badge FREE/PRO, tombol bayar, pricing page,
status grace sudah keimplementasi (T18–T19). Satu-satunya penyesuaian: kalau ada teks/komentar
"Xendit" di UI copy → ganti "Duitku" (cek: `src/components/admin/BillingCard.tsx`,
`src/app/pricing/page.tsx`).

### 8.1 Pricing page `src/app/pricing/page.tsx` (public)

- Harga **Rp99.000/bulan**, benefit PRO (menu tanpa batas, order tanpa batas, antrean s/d 100,
  retensi sprint 30 hari, tanpa badge, prioritas support).
- CTA "Upgrade sekarang" → session admin → `/admin/<slug>/settings?billing=1`; tanpa session → `/login`.

### 8.2 Admin settings — section Billing (BillingCard)

- **Status badge:** FREE (abu) / PRO (amber) + "aktif s/d <tanggal>" kalau PRO.
- FREE: tombol **"Bayar Rp99.000"** → `POST /api/billing/upgrade` → 303 ke `paymentUrl`.
- PRO dlm grace: banner "Langganan berakhir — bayar tagihan utk lanjut".
- PRO aktif: "Otomatis diperpanjang tiap bulan" + tanggal expire.

### 8.3 Route ringkasan (setelah T21)

| Route | Method | Auth | Fungsi |
|---|---|---|---|
| `/api/billing/upgrade` | POST | admin session | Create Payment PENDING + invoice Duitku → return `{ invoiceUrl }` |
| `/api/billing/status` | GET | admin session | Status plan + riwayat Payment terakhir |
| `/api/webhooks/duitku` | POST | HMAC signature | Terima callback resultCode=00 → handlePaid |
| `/api/cron/rebill` | POST | x-cron-secret | Re-bill + downgrade bulanan |
| `/pricing` | GET | public | Halaman harga |

---

## 9. Keamanan

1. **Callback signature:** field `signature` di form POST, verify `HMAC-SHA256(merchantCode + amount
   + merchantOrderId, DUITKU_API_KEY)` + `crypto.timingSafeEqual` (constant-time). Gagal → 401,
   tanpa proses apa pun.
2. **Request signature:** header `x-duitku-signature` utk createInvoice (HMAC merchantCode + timestamp).
3. **Idempotency** (unique `externalId`/`merchantOrderId`, cek status PAID, cek Payment PENDING
   sebelum create) — mencegah double-charge & double-activation.
4. **Validasi amount** di callback: aktivasi hanya kalau `callback.amount >= Payment.amount` (99000).
5. **Tidak ada secret di code:** semua via env var; `lib/duitku.ts` satu-satunya tempat akses
   `DUITKU_API_KEY`; client bundle hanya menerima `paymentUrl`.
6. **Cron auth:** header `x-cron-secret` (constant-time).
7. **IP whitelist opsional** (`DUITKU_CALLBACK_IPS`) — defense-in-depth; signature tetap otoritas utama.
8. **Read-only plan fields** tetap dijaga: settings PATCH menolak `plan`/`planExpiresAt`
   (READONLY_FIELDS) — hanya webhook (verify signature) & cron (verify secret) yang boleh menulis.
9. **CSP:** redirect ke paymentUrl Duitku = top-level navigation, bukan fetch — tidak perlu ubah `connect-src`.

---

## 10. Testing strategy

Stack: vitest (unit + integration dgn DB test seperti `tests/helpers.ts`).

| Area | Test | Cara mock |
|---|---|---|
| `lib/duitku.ts` | createInvoice: header signature benar (merchantCode+timestamp), payload benar, error mapping | `vi.stubGlobal("fetch", ...)` — tanpa network |
| Signature callback | valid signature → pass; salah stringToSign → reject; kosong/malformed → reject; **urutan stringToSign merchantCode+amount+merchantOrderId** | unit murni |
| Callback paid | Payment PENDING → PAID + `plan=PRO, planExpiresAt=now+30d`; amount < 99000 → **tidak** aktivasi; duplikat delivery → 200 no-op; tenant tidak ada → log + 200 | integration dgn DB + parse form |
| Callback failed | resultCode != 00 → EXPIRED/no-op; PAID → no-op | integration |
| Cron re-bill | tenant `planExpiresAt <= now+24h` & tanpa Payment PENDING → create invoice (fetch mock, cek `merchantOrderId`); `planExpiresAt=null` → skip; tenant FREE → skip | integration dgn DB |
| Cron downgrade | boundary `planExpiresAt+3d < now` → FREE; `==` → belum; sudah PAID periode baru → tidak di-downgrade | integration dgn DB |
| Billing upgrade route | no session → 401; sukses → Payment PENDING + `{ invoiceUrl }`; Duitku error → Payment EXPIRED + 502 | integration |
| Pricing page / BillingCard | render 99.000, badge, tombol bayar, status grace | component test |

**E2E manual (staging):** pakai **Duitku sandbox** (`api-sandbox.duitku.com`, merchant code test) →
create invoice → paymentUrl → bayar via simulasi/QRIS test → callback masuk → cek tenant jadi PRO.
Note: test lama `tests/billing-xendit.test.ts` → rename/adapt jadi `tests/billing-duitku.test.ts`.

---

## 11. Demo tenants (kopi-makassar, kopi-senja) — rekomendasi

**Rekomendasi: jangan dihapus, jadikan PRO permanen** (demo & showcase tetap jalan tanpa gate).

```sql
-- JALANKAN MANUAL di DB prod (bukan migration, bukan seed)
UPDATE "Tenant" SET "plan" = 'PRO', "planExpiresAt" = NULL
WHERE "slug" IN ('kopi-makassar', 'kopi-senja');
```

- `planExpiresAt = NULL` → cron re-bill & downgrade otomatis skip (spec §7.3).

---

## 12. Task breakdown

**Status: T13–T20 SELESAI (implementasi Xendit, merged 12b76b7 via PR #258).**
Sisa: **T21 — swap lapisan integrasi Xendit → Duitku.** Estimasi **±1–2 hari**.

| # | Task | File utama | Estimasi |
|---|---|---|---|
| ~~T13~~ | ~~Schema: `Payment` + enum~~ ✅ DONE (Xendit) | `prisma/schema.prisma` | — |
| ~~T14~~ | ~~`lib/xendit.ts` + env~~ ✅ DONE | `src/lib/xendit.ts` | — |
| ~~T15~~ | ~~`/api/billing/upgrade` + `/api/billing/status`~~ ✅ DONE | `src/app/api/billing/*` | — |
| ~~T16~~ | ~~`/api/webhooks/xendit`~~ ✅ DONE | `src/app/api/webhooks/xendit/route.ts` | — |
| ~~T17~~ | ~~`/api/cron/rebill` + rebill.yml~~ ✅ DONE | `src/app/api/cron/rebill/route.ts` | — |
| ~~T18~~ | ~~BillingCard + badge + tombol bayar~~ ✅ DONE | `src/components/admin/BillingCard.tsx` | — |
| ~~T19~~ | ~~Pricing page `/pricing`~~ ✅ DONE | `src/app/pricing/page.tsx` | — |
| ~~T20~~ | ~~Tests + SQL demo tenant~~ ✅ DONE | `tests/billing-*.test.ts` | — |
| **T21** | **Swap Xendit → Duitku:** `src/lib/duitku.ts` (createInvoice header-signature + verifyCallbackSignature), hapus `src/lib/xendit.ts`; route webhook baru `/api/webhooks/duitku` (form POST, resultCode=00), hapus `/api/webhooks/xendit`; cron re-bill panggil Duitku; env vars `DUITKU_*` (+ hapus `XENDIT_*` dari `.env.example`); update rate-limit map; adapt/rename test; hapus komentar "Xendit" di UI copy. **Schema/pricing/billing-card/badge TIDAK berubah** (gateway-agnostic). Opsional (rekomendasi @senior): rename field `xenditInvoiceId` → `gatewayReference` (migration rename). | `src/lib/duitku.ts`, `src/app/api/webhooks/duitku/route.ts`, `src/app/api/cron/rebill/route.ts`, `.env.example`, `tests/billing-*.test.ts`, (opsional) migration rename | 1–2 hari |

**Kriteria selesai T21:** semua test pass (`npm test`), `npx tsc --noEmit` 0 error, `npm run build` OK,
flow manual **Duitku sandbox** tervalidasi di staging (createInvoice → paymentUrl → callback →
PRO aktif), tidak ada sisa referensi `xendit` di `src/` & `.env.example`.

---

## 13. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Volume > Rp500jt/bln → harga khusus Duitku** (pengganti risiko "min monthly fee USD 50 Xendit") | Fee bisa naik/turun via negosiasi di volume besar | Catat sbg biaya platform; evaluasi volume sebelum scale; jangan di-pass ke harga tenant |
| E-wallet/QRIS expiry pendek (channel-dependent, e.g. ShopeePay 60 menit) | Invoice expired sebelum grace 3 hari utk channel tsb | Grace/downgrade tetap otoritas cron (`planExpiresAt`); billing-card tampilkan banner bayar; tenant bisa create invoice baru |
| VA fee Rp1.500–5.000 | Margin tipis kalau tenant pilih VA mahal | QRIS default termurah (0,7%); pricing page highlight QRIS |
| Callback ganda/retry (Duitku retry kalau bukan 200) | Double activation | Idempotency layer §6.4 + selalu balas 200 |
| Callback palsu / replay | Tenant PRO gratis | HMAC signature verify + amount validation + rate limit + IP whitelist opsional |
| **Dua signature beda (request vs callback)** | Salah implementasi → create invoice 401 / callback ditolak | Spec §6.2 eksplisit; unit test kedua signature |
| `merchantOrderId` terlalu panjang / format ditolak Duitku | createInvoice gagal | Verifikasi sandbox; format kompak fallback (§6.2) |
| Vercel Hobby tanpa cron | Re-bill tidak jalan | GitHub Actions (gratis) — §7.1 |
| Tenant lupa bayar → downgrade | Churn | Grace 3 hari + banner di admin + email reminder (opsional, out of scope) |
| `planExpiresAt` drift (UTC vs tz lokal) | Downgrade salah waktu | Semua logika UTC; timestamp signature Duitku (WIB) dihitung eksplisit, tidak dipakai utk logika bisnis |

---

## 14. Out of scope (eksplisit)

- Self-serve cancel/refund tenant (manual via dashboard Duitku / SQL).
- Multi-admin billing, role per-admin.
- Custom domain.
- Annual plan / diskon / promo.
- Auto-debit / tokenisasi akun e-wallet (Recurring — ditolak).
- Email notification engine (reminder tagihan) — cukup banner in-app.
- Integrasi Xendit lama: dihapus total di T21 (tidak dipertahankan paralel).
- Pajak/invoice legal formal (saat revenue konsisten).

---

## 15. Referensi & sumber

- Duitku Pop — Create Invoice (endpoint prod/sandbox, header signature `x-duitku-timestamp` +
  `x-duitku-signature`): https://docs.duitku.com/pop/en/#create-invoice
- Duitku API — Callback (form POST, verify `signature` = HMAC-SHA256(merchantCode + amount +
  merchantOrderId), resultCode=00, wajib balas 200, IP whitelist prod/sandbox):
  https://docs.duitku.com/api/en/#callback
- Duitku API — Expiry Period per channel (VA/retail >1440 menit; e-wallet lebih rendah):
  https://docs.duitku.com/api/en/#expiry-period
- Duitku pricing/fee (verifikasi PM 2026-08-20): QRIS 0,7% · VA Rp1.500–5.000 · e-wallet 2–4% ·
  tanpa minimum monthly fee · harga khusus volume >Rp500jt/bln
- Kodebase: `prisma/schema.prisma` (model Payment, Tenant plan/planExpiresAt),
  `src/lib/xendit.ts` (akan → `src/lib/duitku.ts`), `src/lib/billing.ts` (PRO_PRICE_IDR, nextExpiry),
  `src/lib/plan.ts` (PLAN_FEATURES), `src/app/api/webhooks/xendit/route.ts` (akan → `/duitku`),
  `src/app/api/cron/rebill/route.ts`, `src/lib/rate-limit.ts`, `tests/billing-*.test.ts`,
  `.env.example` (XENDIT_* → DUITKU_*).
