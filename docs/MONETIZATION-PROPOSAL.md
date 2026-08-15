# Proposal: Monetisasi HeadwayBrew — Paket Berlangganan + Pricing

Date: 2026-08-14 · Status: Draft · Owner: PM (orderin)

---

## 1. Ringkasan eksekutif

Saat ini tenant bisa registrasi **gratis, langsung aktif, tanpa kontak** (no email/WA) —
mustahil ditagih, dan platform menanggung seluruh biaya infra tanpa pemasukan.

**Rekomendasi: 2 paket — Free (selamanya) + Pro Rp 49.000/bln.** Tapi **jangan monetize sekarang**:
tetap gratis penuh sampai retensi terbukti. Yang dikerjakan SEKARANG hanya *groundwork* murah
(schema plan + email wajib) supaya monetize nanti tinggal nyalakan, bukan nulis ulang.

- Paket: **Free** (core product lengkap, cap transaksi + badge) vs **Pro** (unlimited, analytics, tanpa badge, multi-admin, custom domain).
- Harga: **Pro Rp 49.000/bln** (annual Rp 490.000 = 2 bulan gratis). Anchor: 2-3x harga segelas kopi, ~1/4 harga POS.
- Break-even infra (≈Rp 111rb/bln) tercapai di **3 tenant Pro**.
- Go-live monetize: saat kedai aktif >2-4 minggu (bukti retensi) ATAU tenant ke-10, mana duluan.

---

## 2. Kondisi sekarang (hasil cek kode)

| Aspek | Fakta |
|---|---|
| Registrasi | `POST /api/register` — 4 field (name, slug, username, password), transaksi create Tenant + TenantAdmin, session cookie auto-login. Tanpa verifikasi, tanpa approval, tanpa email/WA. |
| Billing | TIDAK ADA. Tidak ada model Plan/Billing/Subscription, tidak ada gateway (Midtrans/Xendit), tidak ada pricing page. |
| Payment yang ada | `Order.paymentStatus` (qris/bank/cash) = pembayaran **customer → kedai**. Itu duit tenant, bukan duit platform. |
| Biaya infra | SumoPod PG Rp 100.000/bln (10GB) + domain ~Rp 11rb/bln ≈ **Rp 111.000/bln** (Vercel Hobby free). |

Konsekuensi: setiap tenant baru = beban murni. Tanpa field kontak, tidak ada jalur tagihan sama sekali.

---

## 3. Kenapa paket (dan kenapa 2 tier, bukan 3)

1. **Segmentation natural** — tenant heterogen: warung kecil (1 barista, 20 order/hari) vs kafe (2-5 barista, 200 order/hari). Fitur yang sama, skala beda.
2. **Cap = growth lever** — FREE yang kena cap transaksi = pipeline penjualan terukur; upsell tinggal munculkan banner.
3. **Badge = distribusi** — "Powered by HeadwayBrew" di shopfront FREE = iklan berjalan tiap order.
4. **2 tier, bukan 3** — harga rendah + pilihan sedikit = keputusan mudah. Free→Pro cukup; tier menengah bikin paralysis di segmen price-sensitive.

**Yang TIDAK boleh di-gate (core product, tetap free semua paket):** alur order, queue + ETA, status page, pickup PIN, capture pembayaran (QRIS/bank/cash), jadwal buka/tutup, menu CRUD dasar. Gate fitur ini = bunuh produk; payment capture adalah cara kedai *mendapat* uang, bukan fitur premium.

---

## 4. Paket & perbedaan fitur

| Fitur | Free | Pro (Rp 49rb/bln) |
|---|---|---|
| Menu items | 25 | Unlimited |
| Transaksi (order)/bulan | 300 | Unlimited |
| Akun admin/barista | 1 | 5 |
| Max queue size | 20 | 100 |
| Retensi data order (sprint) | 1 hari | 30 hari |
| Badge "Powered by HeadwayBrew" di shopfront | Ada | Dihilangkan |
| Custom domain (`pesan.kedai.id`) | — | ✓ |
| Analytics (order history, jam sibuk, menu terlaris) | — | ✓ |
| Export data CSV | — | ✓ |
| Support | Komunitas (WA) | Prioritas |
| Logo/alamat/QRIS/bank config | ✓ | ✓ |
| Alur order + queue + status + payment capture | ✓ | ✓ |

Rasional gate: fitur yang **tidak mengganggu operasional harian** (analytics, export, branding, custom domain) = premium. Fitur yang **dipakai tiap transaksi** = free. Cap dipilih dari profil tenant nyata (kopi-makassar): 300 order/bln ≈ 10-15 order/hari — jauh di atas pemakaian warung kecil, jadi FREE terasa "cukup", bukan "dibatasi".

---

## 5. Harga — rekomendasi & rasional

**Pro: Rp 49.000/bln · Rp 490.000/tahun (≈10 bulan) · Launch promo: Rp 29.000/bln utk 20 tenant pertama (3 bulan)**

| Faktor | Angka | Implikasi |
|---|---|---|
| Harga segelas kopi | Rp 15-25rb | Pro = 2-3 gelas/bulan → impulse buy |
| POS kompetitor (Moka dkk) | Rp 100-250rb/bln* | Kita ~1/4-1/2 harga, tapi fokus niche (ordering/queue) |
| Break-even infra | Rp 111rb/bln | 3 tenant Pro monthly, atau ~2.5 tenant annual |
| Nilai utk tenant | 1-2 order ekstra/hari ≈ Rp 1-3jt/bln omzet | Pro = <5% dari nilai yang dihasilkan |

**Kenapa bukan lebih mahal (Rp 99rb+):** target = warung/kafe kecil yang price-sensitive; 49rb = keputusan instan, 99rb = perlu mikir. Naikkan harga nanti setelah base besar + fitur Pro matang.
**Kenapa bukan lebih murah (<29rb):** persepsi nilai — terlalu murah = produk dianggap tidak serius.
**Kenapa Free forever, bukan trial 14 hari:** trial = churn massal di segmen ini (lupa, tidak sempat setup). Free-with-cap = tenant tetap pakai, badge + cap yang menjual upgrade.

\* angka kompetitor = estimasi, perlu verifikasi (lihat §8).

---

## 6. Yang perlu diubah

### Phase 1 — Groundwork (0.5-1 hari) — KERJAKAN SEKARANG
| # | Perubahan | Detail |
|---|---|---|
| 1.1 | Schema: enum Plan + field Tenant | `enum Plan { FREE PRO }`; `Tenant.plan @default(FREE)`, `planExpiresAt DateTime?`, `isActive Boolean @default(true)`, `contactEmail String?` |
| 1.2 | Migration + backfill | Semua tenant existing → `FREE` |
| 1.3 | Registrasi: tambah kontak wajib | Field `contactEmail` (atau WA) di `register/page.tsx` + `api/register/route.ts` — syarat mutlak utk tagihan |

### Phase 2 — Feature gates + badge (1-2 hari) — SETELAH monetize disetujui
| # | Perubahan | Detail |
|---|---|---|
| 2.1 | Helper plan | `lib/plan.ts`: `PLAN_FEATURES` map + `can(tenant, feature)` — satu sumber kebenaran |
| 2.2 | Cap enforcement | Cek count menu items saat create (<25), counter transaksi/bulan (300) — API-side, bukan cuma UI |
| 2.3 | Upsell | FREE yang hit cap / buka fitur Pro → banner "Upgrade ke Pro" |
| 2.4 | Badge | Footer shopfront: FREE = "Powered by HeadwayBrew" (link headwaybrew.com); PRO = hidden |
| 2.5 | Gate UI | Analytics/custom domain/export tersembunyi utk FREE |

### Phase 3 — Billing (2-3 hari) — SETELAH Phase 2
| # | Perubahan | Detail |
|---|---|---|
| 3.1 | Gateway | Xendit/Midtrans **payment link** (tanpa webhook/subscription engine — YAGNI). Fee ~1.5-3%* diabsorb harga |
| 3.2 | Halaman Billing admin tenant | Status plan, riwayat invoice, tombol "Bayar" → payment link |
| 3.3 | Expiry check | `planExpiresAt` lewat → downgrade FREE otomatis saat request |
| 3.4 | Panel internal kita | Daftar tenant + plan + status; **manual activate** setelah pembayaran masuk (cek manual via dashboard gateway) |

### Phase 4 — Launch (0.5 hari)
Pricing page (`/pricing`), promo 20 tenant pertama, grandfather tenant existing (kopi-makassar dst) — **keputusan: gratis selamanya atau 3 bulan Pro?** (Open Q).

---

## 7. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Gate fitur → churn | Gate cuma fitur non-operasional (analytics/branding/cap tinggi); core tetap free |
| Fee gateway menggerus margin | Fee ~Rp 1-2rb/transaksi utk invoice bulanan (bukan per-order) — negligible di Rp 49rb |
| Non-payment / lupa bayar | Mulai manual activate + reminder WA; auto-debit nanti kalau scale |
| Pajak/invoice legal | Tangani saat revenue konsisten (nanti); jangan over-engineer sekarang |
| Custom domain = beban support DNS | Bisa tunda (Open Q) — `<slug>.headwaybrew.com` gratis sudah cukup utk MVP monetisasi |

---

## 8. Sumber & verifikasi yang dibutuhkan

- Harga POS kompetitor (Moka, Qasir, Pawoon) = **estimasi kasar, wajib verifikasi** via web sebelum final (pola sama dgn `pricing-comparison.md`).
- Fee Xendit/Midtrans payment link = verifikasi halaman pricing resmi.
- Kurs/tax tidak relevan (semua Rupiah, tenant lokal).

---

## 9. Open questions

- [ ] Kontak utama tagihan: email atau WA?
- [ ] Grandfather tenant existing (kopi-makassar): gratis selamanya, atau 3 bulan Pro?
- [ ] Rp 49rb/bln disetujui, atau mau annual-only (Rp 490rb) supaya cash flow lebih sehat?
- [ ] Custom domain: didukung sekarang atau tunda (subdomain `.headwaybrew.com` cukup dulu)?
- [ ] Go-live monetize: tunggu bukti retensi (kedai aktif >2-4 minggu) atau tenant ke-10, mana duluan?
