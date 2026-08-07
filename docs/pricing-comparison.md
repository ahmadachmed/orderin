# DB Hosting Pricing Comparison (Managed PostgreSQL focus)

Snapshot: 2026-08-07 — semua angka dari halaman pricing resmi vendor (URL di tiap section).
Free tier di-skip; fokus entry paid tier untuk kebutuhan orderin (Next.js 14.2 + Prisma 7 + PG).

## Ringkasan entry paid tier (termurah → termahal)

| Vendor | Entry paid | Struktur harga |
|---|---|---|
| Fly.io | ~$3–5/mo efektif | Tanpa flat plan fee, pure usage + prepaid credit |
| Railway | $5/mo (Hobby) | Flat kecil + usage metered |
| Aiven | $5/mo (Developer) | Flat per tier + hourly service |
| Render | $6/mo (Basic-256mb) | Flat per instance size |
| Crunchy Bridge | ~$9–10/mo (Hobby-0) | Flat per instance size |
| Neon | usage-based, tanpa minimum | Pay-per-use (compute/storage) |
| DigitalOcean | $15.15/mo (1GB/1vCPU) | Flat per node size |
| Supabase | $25/mo (Pro) | Flat + overage |

## Per vendor

### Neon — https://neon.tech/pricing
- Launch & Scale: TANPA flat monthly fee ("no monthly minimum"), pay-per-use.
- Compute: Launch $0.106/CU-hr, Scale $0.222/CU-hr.
- Storage: $0.35/GB-mo (0.5GB included di Free; 500GB included di paid, lanjut $0.10/GB).
- Branch ekstra: $1.50/branch-mo (prorated hourly; 10 included di Free/Launch, 25 di Scale).
- Snapshots: $0.09/GB-mo. Private networking: $0.01/GB (Scale).

### Supabase — https://supabase.com/pricing
- Pro: $25/mo flat.
- Termasuk: $10/mo compute credits (~cukup 1 micro instance), 8GB disk, 250GB egress, 50K MAU.
- Overage: disk $0.125/GB, egress $0.09/GB, MAU $0.00325/MAU.
- Team plan: Pro + SSO/SOC2/ISO27001 (harga custom; page tidak menampilkan flat fee).
- Custom domain: from $100/mo.

### Railway — https://railway.com/pricing
- Hobby: $5/mo (usage included). Pro: $20/mo (teams).
- Usage: $0.00000772/vCPU-s (~$20/vCPU-mo), $0.00000386/GB-s memory (~$10/GB-mo).
- Disk: $0.015/GB-mo (egress free). Egress: $0.05/GB.

### Aiven — https://aiven.io/pricing (PostgreSQL)
- Developer: $5/mo. Hobbyist: from $12/mo ($0.02/hr).
- Startup: from $75/mo ($0.10/hr). Business: from $180/mo ($0.25/hr). Premium: from $270/mo ($0.37/hr).

### Render — https://render.com/pricing (Postgres)
- Basic-256mb $6/mo, Basic-1gb $19/mo, Basic-4gb $75/mo.
- Pro-4gb $55/mo, Pro-8gb $100/mo, Pro-16gb $200/mo, Pro-32gb $400/mo, Pro-64gb $800/mo.
- Storage ekstra: $0.30/GB-mo (paid only). HA hanya di Pro+.

### Fly.io — https://fly.io/docs/about/pricing/
- Tanpa flat plan fee — pure usage (pay-as-you-go).
- Prepaid credit (diskon 40%): shared $36/yr → $5/mo usage (eff $3/mo); performance $144/yr → $20/mo usage.
- Volumes: $0.15/GB-mo. Egress: $0.02/GB (NA/EU), $0.04/GB (APAC), $0.12/GB (Africa/India).
- IPv4 dedicated: $2/mo.

### Crunchy Bridge — https://www.crunchydata.com/products/crunchy-bridge/pricing
- Hobby-0 $9/mo (0.5GB), Hobby-1 $18/mo (1GB), Hobby-2 $35/mo (2GB), Hobby-4 $70/mo (4GB).
- Standard-4 $70/mo (4GB/1 core), Standard-8 $140/mo (8GB) — naik sampai Standard-384 $6,720/mo.
- Memory-16 $240/mo, Memory-128 $1,920/mo.
- Storage: $0.10/GB-mo. Copy resmi: "plans starting at $10/mo".

### DigitalOcean — https://www.digitalocean.com/pricing/managed-databases (Managed PostgreSQL, Basic single-node)
- 1GB/1vCPU $15.15/mo ($0.02254/hr), 2GB/1vCPU $30.45, 4GB/2vCPU $60.90, 8GB/4vCPU $122.10, 16GB/6vCPU $244.35.
- Storage: $0.215/GiB-mo (10 GiB increments).

## Catatan metodologi
- Semua angka dari HTML halaman resmi (curl). Halaman JS-heavy (Supabase/DO) — angka = card yang ter-render di HTML.
- DO tier Production/HA tidak muncul di HTML page — tidak dicantumkan angka.
- Untuk estimasi bulanan riil orderin: hitung compute + storage + egress sesuai workload (Neon/Railway/Fly = metered, sisanya flat).
