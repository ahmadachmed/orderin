# Proposal: Pemilihan DB Hosting (PostgreSQL) untuk Orderin

Tanggal: 2026-08-07 · Status: Draft evaluasi · Scope: managed PostgreSQL / DB hosting untuk orderin (Next.js 14.2 + Prisma 7 + PG)

---

## 1. Ringkasan Eksekutif

**Rekomendasi baru: SumoPod Managed PostgreSQL (Shared) — Rp 10.000/GB storage/bln.**
Untuk skenario S (10GB storage) = Rp 100.000/bln (~$6.5) — tetap termurah managed,
~2.3x di bawah DigitalOcean ($15.15 ≈ Rp 235rb). Runner-up: DO kalau mau vendor mature.

---

## 2. Asumsi Workload (Skenario S — produksi kecil)

| Parameter | Nilai | Catatan |
|---|---|---|
| Compute | 1 vCPU / 1 GB RAM | cukup untuk storefront skala kecil |
| Storage | 10 GB | data + index, masih muat |
| Egress | 10 GB/bulan | traffic kecil |
| Availability | 24/7 always-on | prod, tidak boleh scale-to-zero |
| Kebutuhan | managed preferred | backup + failover + monitoring |

> Semua estimasi bulanan di bawah = harga resmi (snapshot 2026-08-07) × skenario S.
> Baris "Estimasi S" yang ditandai * adalah perkiraan dari struktur harga, bukan angka resmi.

---

## 3. Tabel Perbandingan Utama

| Vendor | Entry paid | Struktur | Storage incl | Overage storage | Egress | Managed? | Estimasi S (/mo) |
|---|---|---|---|---|---|---|---|
| **SumoPod** | **Rp 10.000/GB storage** (~$0.65/GB) | per GB storage (shared) | 0 (harga per GB) | Rp 10.000/GB | incl | ✅ | **Rp 100rb (10GB)** |
| **Fly.io** | ~$3–5 eff | usage + prepaid credit | 10 GB free | $0.15/GB | $0.02/GB (NA/EU) | ❌ DIY (flyctl) | **~$5–7** |
| **DigitalOcean** | $15.15 (1GB) | flat per node | 30 GiB | $0.215/GiB | incl | ✅ | **$15.15** |
| **Aiven** | $5 (Developer) / from $12 (Hobbyist) | flat plan + hourly service | ~10 GB* | $0.10/GB* | incl | ✅ | **~$12–15*** |
| **Crunchy Bridge** | $9 (Hobby-0) | flat per instance | ~incl* | $0.10/GB | incl | ✅ | **~$18–19*** |
| **Render** | $6 (Basic-256mb) | flat per instance | ~5 GB* | $0.30/GB | incl | ✅ | **~$19–21*** |
| **Neon** | usage, no minimum | pay-per-use | 500 GB | $0.35/GB | incl | ✅ | **$24.35** |
| **Supabase** | $25 (Pro) | flat + overage | 8 GB | $0.125/GB | 250 GB free | ✅ | **$25.25** |
| **Railway** | $5 (Hobby) | flat + metered usage | ~10 GB* | $0.015/GB | $0.05/GB | ❌ container DIY | **~$31*** |

---

## 4. Kalkulasi Detail (Skenario S)

### 4.1 SumoPod Managed PostgreSQL 16 (Shared) — Rp 100.000/bln (10GB) ✅ REKOMENDASI BUDGET
```
PG 16 Shared, storage 10GB × Rp 10.000   Rp 100.000
------------------------------------------------------------
TOTAL                 Rp 100.000   (~$6.5) — managed: backup + pooler + IP allowlist
```
Harga = per GB storage (Rp 10.000/GB). 5GB = Rp 50.000, 20GB = Rp 200.000 — skala linier.
Varian: +PostGIS / +pgvector = Rp 12.500/GB. SKU PostGIS sempat "Out of stock" (supply terbatas).
Catatan: tier SHARED — resource dipakai bareng tenant lain (noisy neighbor), kemungkinan tanpa HA.
DC Jakarta → latency bagus untuk customer lokal.

### 4.2 DigitalOcean — $15.15/mo ✅ REKOMENDASI ZERO-RISK
```
Node 1GB/1vCPU      $15.15
Storage 10GB        $0.00   (30 GiB sudah termasuk di harga node)
Egress              $0.00   (included)
------------------------------------------------------------
TOTAL               $15.15  flat, managed (backup + failover + monitoring)
```

### 4.3 Crunchy Bridge — ~$18–19/mo
```
Hobby-1 (1GB)       $18.00
Storage 10GB        ~$1.00  ($0.10/GB, sebagian included*)
------------------------------------------------------------
TOTAL               ~$18–19  managed, deploy di AWS/Azure/GCP pilihan sendiri
```

### 4.4 Render — ~$19–21/mo
```
Basic-1gb (1GB)     $19.00
Storage ekstra      ~$1–2   ($0.30/GB di luar included*)
------------------------------------------------------------
TOTAL               ~$19–21  managed; HA cuma di Pro+ ($55+)
```

### 4.5 Aiven — ~$12–15/mo* (perlu verifikasi konfigurasi)
```
Hobbyist (small node)  from $12.00  ($0.02/hr × 730 jam)
Storage                ~$1*         ($0.10/GB*)
------------------------------------------------------------
TOTAL                  ~$12–15*  managed; Developer $5/mo = dev-grade
```

### 4.6 Neon — $24.35/mo
```
Compute 0.25 CU × 730j × $0.106   $19.35   (1 CU = 1vCPU/4GB; minimal 0.25 CU)
Storage 10GB × $0.35              $3.50
Branch aktif (1)                  $1.50
------------------------------------------------------------
TOTAL                             $24.35   (bisa turun drastis kalau scale-to-zero)
```
Catatan: paling murah kalau workload bisa scale-to-zero (dev/staging), mahal untuk prod always-on.

### 4.7 Supabase — $25.25/mo
```
Pro flat             $25.00   (incl $10 compute credit ≈ micro instance, 8GB disk, 250GB egress)
Disk 10GB            $0.25    (8GB incl + 2GB × $0.125)
------------------------------------------------------------
TOTAL                $25.25
```

### 4.8 Fly.io — ~$5–7/mo (termurah USD, tapi DIY)
```
Shared machine 1GB   ~$5.00   (prepaid $36/yr → credit $5/mo usage, eff $3/mo)
Volume 10GB × $0.15  $1.50
Egress 10GB × $0.02  $0.20
------------------------------------------------------------
TOTAL                ~$6.70   (Postgres = cluster DIY via flyctl, bukan managed)
```

### 4.9 Railway — ~$31/mo (termahal + DIY)
```
1 vCPU × 730j × $0.00000772    $20.28
1 GB mem × 730j × $0.00000386  $10.14
Disk 10GB × $0.015             $0.15
Egress 10GB × $0.05            $0.50
Hobby credit                   -$5.00
------------------------------------------------------------
TOTAL                          ~$31.07   (Postgres = container DIY)
```

---

## 5. Kesimpulan & Rekomendasi

| Prioritas | Pilihan | Estimasi | Alasan |
|---|---|---|---|
| 🥇 Value (managed, budget) | **SumoPod PG 16 Shared** | Rp 100rb (10GB) | Termurah managed, DC Jakarta (latency lokal bagus) |
| 🥈 Zero-risk (managed) | **DigitalOcean** | $15.15/mo | Vendor mature, 30 GiB storage incl, managed penuh |
| 🥉 Runner-up | **Crunchy Bridge** | ~$18/mo | Multi-cloud, storage $0.10/GB termurah, managed |
| 💸 Budget hemat DIY | **Fly.io** | ~$5–7/mo | Termurah USD, tapi Postgres DIY — butuh maintenance |
| ❌ Skip | Railway | ~$31/mo | Mahal + DIY container |
| ⚠️ Kondisional | Neon | $24.35/mo | Pilih kalau workload bisa scale-to-zero (hemat drastis) |

**Keputusan yang disarankan:** deploy orderin prod ke **SumoPod Managed PostgreSQL 16 (Shared)
storage 10GB (Rp 100.000/bln)** — harga managed termurah, DC Jakarta cocok untuk customer lokal.
Syarat sebelum commit: konfirmasi detail tier Shared (backup retention, HA, RAM/CPU plan, uptime
SLA) via dashboard/support SumoPod. Kalau prefer vendor internasional yang mature: DO Managed PG
1GB ($15.15/mo). Kalau tim siap maintain sendiri dengan budget minimal: Fly.io.

---

## 6. Metodologi & Sumber

- Snapshot 2026-08-07, diambil dari halaman pricing resmi via curl (HTML ter-render).
- Angka tanpa tanda * = harga resmi persis dari halaman vendor. Angka bertanda * = estimasi
  dari struktur harga (perlu verifikasi konfigurasi spesifik sebelum commit).
- Harga SumoPod (Rp 10.000/GB storage, Rp 12.500/GB varian) = dari dashboard akun user (2026-08-07) —
  halaman publik SumoPod tidak menampilkan harga (login-gated).
- DO tier Production/HA tidak muncul di HTML halaman — tidak dicantumkan angkanya.
- Konversi USD: kurs ~Rp 15.400/USD (estimasi, bukan angka resmi).
- Sumber:
  - Neon: https://neon.tech/pricing
  - Supabase: https://supabase.com/pricing
  - Railway: https://railway.com/pricing
  - Aiven: https://aiven.io/pricing
  - Render: https://render.com/pricing
  - Fly.io: https://fly.io/docs/about/pricing/
  - Crunchy Bridge: https://www.crunchydata.com/products/crunchy-bridge/pricing
  - DigitalOcean: https://www.digitalocean.com/pricing/managed-databases
  - SumoPod: https://sumopod.com (harga dari dashboard akun, publik tidak ditampilkan)
