# Proposal: Brand & Domain — EARLYMOVE vs HEADWAY

Date: 2026-08-14 · Status: Draft v2 · Owner: PM (orderin)
Semua status domain = verified RDAP (authoritative registry, 2026-08-14).

---

## Ringkasan eksekutif

Dua kandidat brand final, keduanya aesthetic-implisit (nggak nyebut queue/kopi secara literal), dua-duanya punya opsi .com yang bisa diambil SEKARANG:

| | EARLYMOVE | HEADWAY |
|---|---|---|
| Makna | Gerak duluan / first-mover | Kemajuan / melaju ("make headway") |
| Koneksi produk | Order duluan = early move; kopi siap pas datang | Pesanan nggak nyangkut; proses melaju mulus |
| Tone | Energi, action, Gen Z | Tenang, growth, premium |
| Ketersediaan .com | ✅ (get- varian) | ✅ (banyak varian) |
| Risiko | earlymove.com dipegang pihak lain (2014, aktif 2027) | headway.com dipegang (perusahaan software besar) |

**Keduanya butuh varian .com — nama polosnya sudah kegenggam.** Ini normal (getbootstrap, getsentry, getpostman juga begitu).

---

## 1. EARLYMOVE — opsi .com

Status: `earlymove.com` TAKEN (registrasi 2014, active s/d 2027-03, owner parkir tanpa NS — bisa dinego nanti).

| # | Domain | Status | Alasan |
|---|---|---|---|
| 1 | **getearlymove.com** | ✅ AVAILABLE | **Primer.** Pola "get+" = standar SaaS (getbootstrap/getsentry/getpostman). Brand tetap "Earlymove" utuh, .com murah, gampang diucap: "get-early-move". |
| 2 | **earlymovecoffee.com** | ✅ AVAILABLE | Eksplisit kopi. Bagus kalau mau langsung jelas industri, tapi ngebatesin ekspansi non-kopi. |
| 3 | **earlymoveapp.com** | ✅ AVAILABLE | Menekankan produk aplikasi (mobile-first). |
| 4 | **tryearlymove.com** | ✅ AVAILABLE | Pola "try" = CTA marketing (trial). Kurang cocok buat domain utama. |
| 5 | **earlymovehq.com** | ✅ AVAILABLE | Vibe startup-HQ. Oke sebagai alternatif, kurang natural diucap. |

> Rekomendasi: `getearlymove.com` (utama) + `earlymovecoffee.com` atau `earlymove.app` sebagai redirect.

---

## 2. HEADWAY — opsi .com

Status: `headway.com` TAKEN (perusahaan software; mahal kalau dinego — skip).

| # | Domain | Status | Alasan |
|---|---|---|---|
| 1 | **headwaybrew.com** | ✅ AVAILABLE | **Primer.** "Make headway" (melaju) + brew (seduh). Aesthetic, dua kata saling menguatkan, brandable. |
| 2 | **headwaynow.com** | ✅ AVAILABLE | "Headway now" — sekarang, pas waktunya. Nuansa waktu (early bird). Bagus buat CTA/tagline. |
| 3 | **headwaybar.com** | ✅ AVAILABLE | Bar = kedai kopi. Pendek, bersih, konteks venue. |
| 4 | **headwayorder.com** | ✅ AVAILABLE | Eksplisit order. Fungsional, kurang aesthetic. |
| 5 | **headwaycafe.com** / **headwaycup.com** / **headwaycups.com** / **headwaybeans.com** / **headwaybrewcoffee.com** | ✅ AVAILABLE | Variasi tema kedai/kopi — semua kebuka, murah buat di-cadangin (redirect). |

> Rekomendasi: `headwaybrew.com` (utama) + `headwaynow.com` (redirect/tagline).

---

## 3. Harga domain (per tahun, per TLD)

### .com (candidates di atas)
| Platform | Harga tahun pertama | Renewal | Catatan |
|---|---|---|---|
| **Cloudflare Registrar** ⭐ | ~USD 10.44 | ~USD 10.44 | At-cost, paling murah stabil; DNS+CDN gratis; anti-scalping; renew nggak di-markup. Butuh akun Cloudflare (gratis). |
| **Porkbun** | ~USD 9-11 (promo) | ~USD 10-11 | UI paling simpel; WHOIS privacy GRATIS selamanya. |
| **Namecheap** | ~USD 7-12 (promo) | ~USD 11-13 | Paling dikenal; privacy gratis tahun pertama. |

### Niche TLD (opsional, redirect)
| TLD | Harga/thn | Catatan |
|---|---|---|
| .app | ~USD 12-14 | HTTPS wajib — bagus buat produk app |
| .coffee | ~USD 28-40 | Paling "kopi" tapi mahal |
| .cafe | ~USD 25-35 | Alternatif .coffee |

### .id (opsional — kamu anggap mahal, tapi buat perbandingan)
| Platform | Harga/thn |
|---|---|
| Domainesia / Niagahoster / Pandigital | ~Rp150-400rb (butuh NIK untuk .id) |

---

## 4. Rekomendasi pembelian

1. **Beli sekarang (wajib):** `getearlymove.com` ATAU `headwaybrew.com` — tergantung pilihan brand. Via **Cloudflare Registrar** (paling murah + DNS langsung nyambung ke Vercel).
2. **Cadangkan (opsional, murah):** 1-2 varian lain dari brand yang sama → 301 redirect ke utama (proteksi typo + brand).
3. **Nanti:** .id / niche TLD kalau trafik lokal naik.

### Cara beli di Cloudflare (5 menit)
1. Daftar/buka account.cloudflare.com (gratis)
2. Dashboard → Domain Registration → Register Domain
3. Cari `getearlymove.com` / `headwaybrew.com` → Add → Bayar (kartu)
4. Selesai — DNS otomatis dikelola Cloudflare, tinggal arahkan ke Vercel:
   - Vercel project → Settings → Domains → Add `getearlymove.com` + `www`
   - Di Cloudflare: CNAME `www` → `cname.vercel-dns.com` (atau ikuti instruksi Vercel)
   - Vercel auto-provision TLS

---

## 5. Keputusan: pakai yang mana?

| Pertimbangan | EARLYMOVE | HEADWAY |
|---|---|---|
| Kalau mau vibe **energi/action/Gen Z** | ✅ | — |
| Kalau mau vibe **premium/growth/tenang** | — | ✅ |
| Kalau mau brand **paling beda dari kompetitor** | ✅ (nggak ada yang pakai "move") | ~ (headway dipakai software company) |
| Kalau mau **cerita paling nyambung ke order-ahead** | ✅ "move early" = order duluan | ✅ "make headway" = mulus |
| Domain paling bersih | getearlymove.com | headwaybrew.com |
| Risiko bentrok brand global | Rendah | Sedang (headway.com = software co) |

**Verdict PM:** kalau target market Gen Z + kopi lokal → **EARLYMOVE (getearlymove.com)**. Kalau mau brand yang lebih "dewasa" & premium → **HEADWAY (headwaybrew.com)**. Dua-duanya aman dibeli sekarang (registrar mana pun, ~USD 10).

---

## 6. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Nama polos (.com) dipegang pihak lain | get-/varian = standar industri; nego hanya kalau scale besar (≥2027) |
| "early" dikira jam buka | Tagline mengarahkan ("Move early. Sip later.") |
| Headway bentrok brand software | Cek trademark dulu (USPTO/DJKI) sebelum scale besar; varian "headwaybrew" cukup unik |
| .id mahal | Skip — .com dulu |
