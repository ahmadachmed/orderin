# Proposal: Pemilihan DB Hosting (PostgreSQL) untuk Orderin

Tanggal: 2026-08-07 · Status: Draft evaluasi · Scope: managed PostgreSQL / DB hosting untuk orderin (Next.js 14.2 + Prisma 7 + PG)

---

## 1. Ringkasan Eksekutif

**Rekomendasi: DigitalOcean Managed PostgreSQL ($15.15/mo) = paling worth it untuk kebutuhan orderin.**
Runner-up: Crunchy Bridge (~$18/mo) — alternatif multi-cloud dengan storage termurah.
Kalau budget sangat ketat dan tim mau kelola sendiri: Fly.io (~$5–7/mo) — tapi bukan managed.

Alasan DO menang: harga flat termurah untuk skenario produksi kecil, storage 30 GiB sudah
termasuk di harga dasar, fully managed (backup, failover, monitoring), tanpa overage tersembunyi
di range workload orderin.

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

### 4.1 DigitalOcean — $15.15/mo ✅ REKOMENDASI
```
Node 1GB/1vCPU      $15.15
Storage 10GB        $0.00   (30 GiB sudah termasuk di harga node)
Egress              $0.00   (included)
------------------------------------------------------------
TOTAL               $15.15  flat, managed (backup + failover + monitoring)
```

### 4.2 Crunchy Bridge — ~$18–19/mo
```
Hobby-1 (1GB)       $18.00
Storage 10GB        ~$1.00  ($0.10/GB, sebagian included*)
------------------------------------------------------------
TOTAL               ~$18–19  managed, deploy di AWS/Azure/GCP pilihan sendiri
```

### 4.3 Render — ~$19–21/mo
```
Basic-1gb (1GB)     $19.00
Storage ekstra      ~$1–2   ($0.30/GB di luar included*)
------------------------------------------------------------
TOTAL               ~$19–21  managed; HA cuma di Pro+ ($55+)
```

### 4.4 Aiven — ~$12–15/mo* (perlu verifikasi konfigurasi)
```
Hobbyist (small node)  from $12.00  ($0.02/hr × 730 jam)
Storage                ~$1*         ($0.10/GB*)
------------------------------------------------------------
TOTAL                  ~$12–15*  managed; Developer $5/mo = dev-grade
```

### 4.5 Neon — $24.35/mo
```
Compute 0.25 CU × 730j × $0.106   $19.35   (1 CU = 1vCPU/4GB; minimal 0.25 CU)
Storage 10GB × $0.35              $3.50
Branch aktif (1)                  $1.50
------------------------------------------------------------
TOTAL                             $24.35   (bisa turun drastis kalau scale-to-zero)
```
Catatan: paling murah kalau workload bisa scale-to-zero (dev/staging), mahal untuk prod always-on.

### 4.6 Supabase — $25.25/mo
```
Pro flat             $25.00   (incl $10 compute credit ≈ micro instance, 8GB disk, 250GB egress)
Disk 10GB            $0.25    (8GB incl + 2GB × $0.125)
------------------------------------------------------------
TOTAL                $25.25
```

### 4.7 Fly.io — ~$5–7/mo (paling murah, tapi DIY)
```
Shared machine 1GB   ~$5.00   (prepaid $36/yr → credit $5/mo usage, eff $3/mo)
Volume 10GB × $0.15  $1.50
Egress 10GB × $0.02  $0.20
------------------------------------------------------------
TOTAL                ~$6.70   (Postgres = cluster DIY via flyctl, bukan managed)
```

### 4.8 Railway — ~$31/mo (termahal + DIY)
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
| 🥇 Value (managed) | **DigitalOcean** | $15.15/mo | Flat termurah, 30 GiB storage incl, managed penuh |
| 🥈 Runner-up | **Crunchy Bridge** | ~$18/mo | Multi-cloud, storage $0.10/GB termurah, managed |
| 🥉 Budget hemat | **Fly.io** | ~$5–7/mo | Termurah, tapi Postgres DIY — butuh maintenance |
| ❌ Skip | Railway | ~$31/mo | Mahal + DIY container |
| ⚠️ Kondisional | Neon | $24.35/mo | Pilih kalau workload bisa scale-to-zero (hemat drastis) |

**Keputusan yang disarankan:** deploy orderin prod ke DO Managed PostgreSQL 1GB/1vCPU
($15.15/mo flat). Kalau tim prefer infra di multi-cloud (bukan lock ke DO): Crunchy Bridge.
Kalau tujuan utama = biaya seminimal mungkin dan ada kapasitas maintain sendiri: Fly.io.

---

## 6. Metodologi & Sumber

- Snapshot 2026-08-07, diambil dari halaman pricing resmi via curl (HTML ter-render).
- Angka tanpa tanda * = harga resmi persis dari halaman vendor. Angka bertanda * = estimasi
  dari struktur harga (perlu verifikasi konfigurasi spesifik sebelum commit).
- DO tier Production/HA tidak muncul di HTML halaman — tidak dicantumkan angkanya.
- Sumber:
  - Neon: https://neon.tech/pricing
  - Supabase: https://supabase.com/pricing
  - Railway: https://railway.com/pricing
  - Aiven: https://aiven.io/pricing
  - Render: https://render.com/pricing
  - Fly.io: https://fly.io/docs/about/pricing/
  - Crunchy Bridge: https://www.crunchydata.com/products/crunchy-bridge/pricing
  - DigitalOcean: https://www.digitalocean.com/pricing/managed-databases
