# Proposal: Rebrand Orderin → HeadwayBrew

Date: 2026-08-14 · Status: Draft · Owner: PM (orderin)

---

## 1. Ringkasan eksekutif

Domain `headwaybrew.com` sudah aktif (dibeli di Rumahweb, DNS → Vercel, SSL jalan, prod deploy live). Brand "Orderin" adalah nama kerja sejak awal; sekarang saatnya rebrand ke **HeadwayBrew** sebelum ada tenant riil / flow berbayar — biaya migrasi = nol karena produk belum diluncurkan.

**Rekomendasi: ganti SEMUA sekarang** (user-facing + internal identifiers) karena belum ada user riil yang terdampak. Satu-satunya pengecualian: repo GitHub rename = opsional, bisa nyusul.

---

## 2. Kenapa rebrand sekarang

| Alasan | Detail |
|---|---|
| Nama kerja | "Orderin" deskriptif-literal (order + in) — melanggar preferensi brand implisit/aesthetic |
| Domain sudah final | headwaybrew.com aktif; brand harus ikut domain (bukan sebaliknya) |
| Belum ada user | Tenant register/beli paket belum dibangun → ganti identitas sekarang = gratis |
| Konsistensi | Semua surface (title, UI, cookie, storage) masih "orderin" — makin lama makin mahal diganti |

---

## 3. Scope perubahan — lengkap (hasil grep, 78 kemunculan)

### 3A. User-facing (WAJIB, prioritas 1)

| # | File:line | Sekarang | Menjadi |
|---|---|---|---|
| 1 | `src/app/layout.tsx:21` | `title: "Orderin — Pesan Kopi, Skip Antre"` | `title: "HeadwayBrew — Pesan Kopi, Skip Antre"` |
| 2 | `src/app/page.tsx:36` | `Orderin` (landing hero) | `HeadwayBrew` |
| 3 | `src/app/login/page.tsx:111` | `Masuk untuk mengelola kedai Anda di Orderin.` | `Masuk untuk mengelola kedai Anda di HeadwayBrew.` |
| 4 | `src/app/register/page.tsx:124` | `Daftarkan kedai kopi Anda di Orderin — gratis.` | `Daftarkan kedai kopi Anda di HeadwayBrew — gratis.` |
| 5 | `src/components/admin/Sidebar.tsx:48` | `Orderin` | `HeadwayBrew` |
| 6 | `src/app/admin/[tenantSlug]/layout.tsx:34` | `{shopName \|\| "Orderin"}` | `{shopName \|\| "HeadwayBrew"}` |

### 3B. Internal identifiers (REKOMENDASI ganti — belum ada user, jadi aman)

| # | File | Identifier | Risiko ganti sekarang |
|---|---|---|---|
| 7 | `src/lib/auth.ts:9` | cookie `orderin_admin_session` | Nol (belum ada admin riil) |
| 8 | `src/lib/customer-auth.ts:11` | cookie `orderin_customer_session` | Nol |
| 9 | `src/lib/auth.ts:11,17` | default `SESSION_SECRET` = `orderin-dev-insecure-secret-change-me` | Aman — **wajib cek env `SESSION_SECRET` di Vercel sudah ter-set non-default**; kalau belum, set dulu |
| 10 | `src/components/OrderForm.tsx:132,140` + `OrderPersistence.tsx:13,16` + `ActiveOrderBanner.tsx:12` | localStorage `orderin_orders` | Nol (cart draft belum ada user) |
| 11 | `src/app/login/page.tsx:20` | localStorage `orderin:last-tenant-slug` | Nol |
| 12 | `src/lib/prisma.ts:94` | log prefix `[orderin]` | Kosmetik, aman |
| 13 | `package.json:2` | `"name": "orderin"` | Kosmetik, aman |

### 3C. Docs internal (opsional, prioritas 3)

- `README.md:1` — `# orderin` → `# headwaybrew` + deskripsi
- `CLAUDE.md:1` — `# CLAUDE.md — Orderin` → HeadwayBrew
- Docs lain (`docs/*.md`, e2e comments `orderin-pg`, T-plan) — **BIARKAN** (arsip/historis, jangan diubah)

### 3D. GitHub repo (opsional, keputusan user)

- Rename `ahmadachmed/orderin` → `ahmadachmed/headwaybrew` (GitHub auto-redirect, aman)
- Pro: konsisten. Kontra: semua link issue/PR/docs lama patah ke nama baru (redirect tetap jalan).

---

## 4. Urutan eksekusi

```
1. Cek env Vercel: SESSION_SECRET ter-set?  (kalau belum → set dulu, baru rebrand)
2. Branch: rebrand/headwaybrew
3. Patch 3A (6 file user-facing)
4. Patch 3B (cookie/storage/secret default/package.json)
5. Patch 3C (README, CLAUDE.md)
6. Test: npm test + e2e happy-path (cek asersi ga nembak "Orderin")
7. PR → review → merge → deploy Vercel
8. Verifikasi headwaybrew.com live + title/hero berubah
9. (Opsional) Rename repo GitHub
```

---

## 5. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| `SESSION_SECRET` default masih dipakai prod | Cek env Vercel dulu; ganti secret = semua session logout (aman, belum ada user) |
| Test asersi "Orderin" | Grep `Orderin` di `tests/` + `e2e/` sebelum merge; update kalau ada |
| SEO/index Google lama | Belum ada traffic; domain baru = fresh start, tidak perlu redirect 301 |
| Email/payment branding | Belum ada; Titan/sesi email belum dibeli (keputusan sudah: skip) |

---

## 6. Yang gak diganti (sengaja)

- Nama DB/table Prisma (`schema.prisma` — model `Tenant`, bukan branding)
- `vercel.json`, nama project Vercel `orderin` (bisa diubah nanti via dashboard, kosmetik)
- Docs arsip (`docs/T*.md`, `DOMAIN-PROPOSAL.md` — historis)
- Kode internal variabel `orderInQueue` (queue logic, bukan brand)

---

## 7. Keputusan yang dibutuhkan

- [ ] Setuju ganti 3B (cookie/localStorage) sekarang — atau biarkan sampai ada user?
- [ ] Rename repo GitHub `orderin` → `headwaybrew`? (opsional)
- [ ] Tagline: pertahankan "Pesan Kopi, Skip Antre" atau cari tagline baru (HeadwayBrew vibe: "make headway")?

---

## 8. Lampiran — inventori lengkap kemunculan "orderin"

- `src/` (23): 6 user-facing + 17 internal (cookie 2, storage 5, secret 3, log prefix 1, komentar 6)
- `tests/` (15): komentar + asersi konteks (tidak menyebut string "Orderin" UI — perlu verifikasi 1 file)
- `e2e/` (5): komentar `orderin-pg` (nama DB lokal) — tidak perlu diubah
- `docs/` (30): arsip, tidak diubah
- `README.md` (2), `CLAUDE.md` (1), `package.json` (1), `package-lock.json` (2)
