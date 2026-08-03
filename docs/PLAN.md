# SaaS Multitenant Order Kopi Takeaway — PRD & Technical Plan

> **Status:** Draft — menunggu review PM  
> **Target:** Platform SaaS multitenant order kopi takeaway  
> **Klien:** Kedai kopi di Makassar (takeaway-only, no delivery)  
> **Repo:** Belum dibuat — struktur folder direncanakan di bawah

---

## 1. Problem Statement

Kedai kopi takeaway di Makassar menghadapi penumpukan antrian fisik di jam sibuk (pagi 07:00–09:00, siang 12:00–14:00). Customer datang bersamaan, barista kewalahan, customer menunggu lama → pengalaman buruk → kehilangan penjualan.

**Akar masalah:** Customer dan kedai tidak punya mekanisme komunikasi pra-kedatangan. Customer tidak tahu kapan kopi siap, kedai tidak bisa mengatur beban kerja.

**Solusi:** Platform web order-ahead — customer pesan dari HP, sistem estimasi waktu siap, customer datang hanya saat kopi sudah ready. Tanpa delivery (menghindari kompleksitas logistik + biaya). Fokus: mengurangi antrian fisik, meningkatkan throughput kedai.

---

## 2. Multitenancy Model

### 2.1 Analisis Tradeoff

| Model | Pro | Kontra | Verdict |
|-------|-----|--------|---------|
| **Shared schema + tenant_id** | 1 DB, murah, onboarding instan, query simpel | Isolasi data via aplikasi (risk leak kalau ada bug query), noisy neighbor di DB level | ✅ **Pilih ini** |
| **Schema-per-tenant** | Isolasi kuat, backup/restore per tenant mudah | N tenant = N schema, migrasi DB nightmare, pooling connection rumit, mahal di Aiven | ❌ Overkill untuk skala kedai kopi |
| **Hybrid (shared + schema kustom)** | Fleksibel | Kompleksitas ganda, tidak ada use case jelas di MVP | ❌ YAGNI |

### 2.2 Keputusan: Shared Schema + Row-Level Isolation

- Setiap tabel punya kolom `tenant_id` (UUID, FK ke `tenants`)
- **Semua query di-filter `WHERE tenant_id = $currentTenantId`** — tidak bisa pakai RLS native PostgreSQL karena Prisma tidak support `SET LOCAL` / `app.current_tenant_id` di connection level tanpa raw query. Alternatif: Prisma middleware / client extension untuk inject `tenant_id` otomatis.
- **Middleware pattern:**
  ```ts
  // lib/prisma.ts
  const prisma = new PrismaClient().$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (args.where && model !== 'Tenant') {
            args.where.tenantId = currentTenantId(); // dari subdomain/slug
          }
          return query(args);
        },
      },
    },
  });
  ```
- Tenant routing via **subdomain** (`kedaiA.kopi.app`) atau **path slug** (`kopi.app/s/kedaiA`). MVP pakai slug — tidak perlu wildcard DNS.

### 2.3 Onboarding Tenant

1. Kedai daftar via landing page → dapat slug + subdomain
2. Admin kedai isi: nama kedai, alamat, jam operasional, logo (opsional)
3. Admin kedai input menu via dashboard
4. Kedai langsung live — customer bisa akses via `kopi.app/s/<slug>`

---

## 3. Core Flow

```
[CUSTOMER]                              [SYSTEM]                            [KEDAI/BARISTA]
    │                                       │                                      │
    ├─ Buka kopi.app/s/<kedai>              │                                      │
    ├─ Lihat menu + estimasi antrian        │                                      │
    ├─ Pilih item, input nama + no.HP       │                                      │
    ├─ Submit order ──────────────────────► │                                      │
    │                                       ├─ Buat Order (status: pending)        │
    │                                       ├─ Kalkulasi ETA dari queue            │
    │                                       ├─ Kirim notif ke dashboard kedai ───► ├─ Lihat order baru
    │                                       │                                      ├─ Confirm (→confirmed)
    │◄─── Tampil halaman status order ──── ├─ Tampilkan ETA + status live         │
    │                                       │                                      ├─ Mulai brewing (→brewing)
    │                                       │                                      ├─ Selesai (→ready_for_pickup)
    │◄─── Notifikasi "kopi siap" ───────── ├─ Notifikasi via WhatsApp (opsional)  │
    │                                       │                                      │
    ├─ Datang ke kedai, ambil kopi          │                                      ├─ Serahkan (→picked_up)
```

### 3.1 Status Order (State Machine)

```
pending ──► confirmed ──► brewing ──► ready_for_pickup ──► picked_up
   │                                                              │
   └────────────────── cancelled (hanya di pending) ◄─────────────┘
```

- **pending:** Customer submit, belum di-confirm barista
- **confirmed:** Barista accept order, antrian terhitung
- **brewing:** Barista mulai proses
- **ready_for_pickup:** Kopi siap, customer dinotifikasi
- **picked_up:** Customer ambil, order selesai
- **cancelled:** Hanya bisa dari `pending` (belum ada kerja barista)

### 3.2 Customer View (Public)

- Halaman menu per kedai (`/[tenantSlug]`)
- Tampilan: nama kedai, menu items (nama, harga, estimasi waktu buat), status antrian saat ini ("~15 menit")
- Form order: pilih item + qty, input nama + no.HP
- Halaman status: order ID, status live, estimasi siap
- **Tanpa login/register** — identifikasi via no.HP + nama (MVP)

### 3.3 Kedai Dashboard (Admin)

- Login via magic link / OTP ke no.HP (MVP: username + password sederhana)
- Dashboard: list order aktif (pending → ready), drag-and-drop untuk update status
- Manajemen menu: CRUD MenuItem
- Jam operasional: set buka/tutup (otomatis tolak order di luar jam)
- Toggle: terima order / pause (kalau terlalu rame)

---

## 4. Queue Management & Estimasi Waktu

### 4.1 Model Sederhana (MVP)

```
ETA = Σ (waktu_persiapan_per_item × qty) untuk semua order di antrian sebelum order ini
    + (waktu_persiapan_per_item × qty untuk order ini sendiri)
```

- Setiap `MenuItem` punya `prep_time_seconds` (default 120s untuk kopi standar, bisa di-set per item oleh admin kedai)
- Antrian FIFO per tenant — order di antrian diproses sesuai urutan `confirmed`
- ETA dihitung ulang setiap kali order selesai (`ready_for_pickup` / `picked_up`) atau order baru masuk

### 4.2 Formula ETA

```
remaining_time_seconds = SUM(order_items × menu_item.prep_time_seconds)
                         untuk semua order dengan status IN (pending, confirmed, brewing)
                         yang dibuat SEBELUM order ini
                         
current_order_eta = remaining_time_seconds + (order_items × menu_item.prep_time_seconds)
```

### 4.3 Anti-Penumpukan

- **Pause orders:** Admin kedai bisa pause penerimaan order baru (toggle di dashboard)
- **Order cap:** Maksimal N order di status `pending` + `confirmed` + `brewing` (default 20, bisa di-set per tenant)
- **Jam operasional:** Di luar jam buka → tolak order, tampil "Tutup — buka lagi jam X"
- **ETA transparan:** Customer lihat estimasi sebelum submit → ekspektasi terkelola

### 4.4 Future Enhancement (Post-MVP)

- Weighted prep time (minuman panas vs dingin, single vs double shot)
- Barista capacity (N barista = throughput × N)
- Historical average adjustment (ML ringan: actual vs estimated prep time)

---

## 5. Stack Recommendation

| Layer | Teknologi | Alasan |
|-------|-----------|--------|
| **Frontend** | Next.js 14+ (App Router) | SSR/SSG untuk halaman menu (SEO kedai), RSC untuk dashboard realtime |
| **Bahasa** | TypeScript (strict) | Type safety, same stack as project-one |
| **ORM** | Prisma | Type-safe, migrasi deklaratif, client extension untuk multitenancy |
| **Database** | PostgreSQL (Aiven) | Managed, murah mulai $19/bln, cocok untuk multitenant shared schema |
| **Deploy** | Vercel (Hobby/Pro) | Edge functions, auto-deploy, integrated with Next.js |
| **Styling** | Tailwind CSS | Utility-first, cepat prototyping |
| **Realtime** | Vercel Edge Config + SWR polling (MVP) | Simpel, tanpa WebSocket. Post-MVP: Server-Sent Events |
| **Notifikasi** | WhatsApp Business API (post-MVP) | Channel utama di Indonesia. MVP: tampilan status di layar |
| **Auth** | next-auth (post-MVP) | MVP: session-based sederhana untuk admin kedai |
| **Payment** | Tidak ada di MVP | Cash on pickup |

### 5.1 Kenapa Bukan...

| Alternatif | Kenapa Ditolak |
|------------|----------------|
| **Supabase** | Bagus, tapi lebih mahal di skala dan vendor lock-in. Aiven Postgres standar, mudah migrasi |
| **Django/Rails** | Full-stack JS lebih efisien untuk tim kecil; Next.js handle frontend + API di 1 repo |
| **Microservices** | Overkill. Monolith Next.js cukup untuk skala puluhan kedai |
| **Firebase/Firestore** | NoSQL susah untuk relasi order-item-menu, migrasi data kompleks |

---

## 6. MVP Scope vs Later

### 6.1 MVP (v1.0)

| Fitur | Detail |
|-------|--------|
| ✅ Landing page | Daftar kedai, registrasi tenant |
| ✅ Halaman menu per tenant | View-only, slug-based routing |
| ✅ Order tanpa login | Input nama + no.HP, submit order |
| ✅ Status order live | Polling 5 detik, tampil ETA |
| ✅ Dashboard kedai | List order + update status, CRUD menu, jam operasional |
| ✅ Queue & ETA | Kalkulasi sederhana FIFO |
| ✅ Tenant admin login | Username + password (sederhana) |
| ✅ Pause/resume orders | Toggle di dashboard |

### 6.2 Post-MVP (v1.1+)

| Fitur | Prioritas |
|-------|-----------|
| 🔜 WhatsApp notifikasi | High — channel komunikasi utama di Indonesia |
| 🔜 Riwayat order customer | Medium — retensi |
| 🔜 QR code pickup | Medium — verifikasi pengambilan |
| 🔜 Menu image upload | Medium |
| 🔜 Multi-barista workflow | Low |
| 🔜 Payment integration (QRIS, GoPay) | Low — cash on pickup cukup |
| 🔜 Customer login + favorite orders | Low |

### 6.3 Explicitly Out of Scope

- ❌ Delivery/logistik (Gojek, Grab)
- ❌ Loyalty program / poin
- ❌ Multi-cabang management (1 tenant = 1 kedai fisik)
- ❌ Native mobile app (web mobile-first cukup)
- ❌ Integrasi POS/QRIS

---

## 7. Data Model (Draft)

### 7.1 Entity Relationship

```
Tenant ──1:N──► MenuItem
Tenant ──1:N──► Order
Tenant ──1:N──► TenantAdmin
Order  ──1:N──► OrderItem
MenuItem ──1:N──► OrderItem
Order  ──1:N──► OrderStatusLog
```

### 7.2 Schema Prisma

```prisma
model Tenant {
  id            String    @id @default(uuid()) @db.Uuid
  slug          String    @unique
  name          String
  address       String?
  phone         String?
  logoUrl       String?
  isOpen        Boolean   @default(true)
  openTime      String    @default("07:00")  // HH:mm UTC
  closeTime     String    @default("21:00")  // HH:mm UTC
  timezone      String    @default("Asia/Makassar")
  maxQueueSize  Int       @default(20)
  prepTimeBuffer Int      @default(0)        // buffer menit tambahan
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  menuItems     MenuItem[]
  orders        Order[]
  admins        TenantAdmin[]
}

model TenantAdmin {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @db.Uuid
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  username     String
  passwordHash String
  createdAt    DateTime @default(now())

  @@unique([tenantId, username])
}

model MenuItem {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @db.Uuid
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  name          String
  description   String?
  price         Decimal  @db.Decimal(10, 2)
  imageUrl      String?
  prepTimeSeconds Int    @default(120)       // estimasi persiapan per item
  isAvailable   Boolean  @default(true)
  sortOrder     Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  orderItems    OrderItem[]
}

model Order {
  id            String        @id @default(uuid()) @db.Uuid
  tenantId      String        @db.Uuid
  tenant        Tenant        @relation(fields: [tenantId], references: [id])
  customerName  String
  customerPhone String
  status        OrderStatus   @default(PENDING)
  etaSeconds    Int?          // estimasi waktu siap dalam detik (dari sekarang)
  etaCalculatedAt DateTime?   // kapan ETA terakhir dikalkulasi
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  items         OrderItem[]
  statusLogs    OrderStatusLog[]
}

model OrderItem {
  id         String   @id @default(uuid()) @db.Uuid
  orderId    String   @db.Uuid
  order      Order    @relation(fields: [orderId], references: [id])
  menuItemId String   @db.Uuid
  menuItem   MenuItem @relation(fields: [menuItemId], references: [id])
  quantity   Int      @default(1)
  unitPrice  Decimal  @db.Decimal(10, 2)

  @@unique([orderId, menuItemId])
}

model OrderStatusLog {
  id        String      @id @default(uuid()) @db.Uuid
  orderId   String      @db.Uuid
  order     Order       @relation(fields: [orderId], references: [id])
  status    OrderStatus
  note      String?
  createdAt DateTime    @default(now())
}

enum OrderStatus {
  PENDING
  CONFIRMED
  BREWING
  READY_FOR_PICKUP
  PICKED_UP
  CANCELLED
}
```

### 7.3 Timezone Strategy

Mengikuti pola **all-UTC** dari project-one:
- Semua `DateTime` disimpan UTC
- `openTime`/`closeTime` disimpan sebagai `HH:mm` UTC (tenant bertanggung jawab konversi dari timezone lokal saat set)
- ETA dikalkulasi dalam detik (durasi), bukan timestamp absolut → tidak terpengaruh timezone
- Konversi zona waktu hanya di layer presentasi

### 7.4 Index Strategy

```sql
-- Lookup tenant via slug (setiap request)
CREATE INDEX idx_tenant_slug ON "Tenant"("slug");

-- List menu per tenant
CREATE INDEX idx_menu_item_tenant ON "MenuItem"("tenantId");

-- List order per tenant, sorted by time
CREATE INDEX idx_order_tenant_status ON "Order"("tenantId", "status", "createdAt");

-- Cari order by customer phone
CREATE INDEX idx_order_phone ON "Order"("customerPhone");

-- Status log per order
CREATE INDEX idx_status_log_order ON "OrderStatusLog"("orderId");
```

---

## 8. Struktur Folder (Rencana)

```
kopi-order/
├── .github/
│   └── workflows/
│       └── ci.yml                    # Lint + type-check + build
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                       # Seed tenant demo + menu sample
├── public/
│   └── assets/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout
│   │   ├── page.tsx                  # Landing page (daftar kedai)
│   │   ├── [tenantSlug]/
│   │   │   ├── page.tsx              # Menu kedai (public)
│   │   │   ├── order/
│   │   │   │   └── [orderId]/
│   │   │   │       └── page.tsx      # Status order (public)
│   │   │   └── layout.tsx
│   │   ├── api/
│   │   │   ├── order/
│   │   │   │   ├── route.ts          # POST create order
│   │   │   │   └── [orderId]/
│   │   │   │       └── route.ts      # GET order status
│   │   │   ├── tenant/
│   │   │   │   └── [slug]/
│   │   │   │       └── menu/
│   │   │   │           └── route.ts  # GET menu items
│   │   │   └── admin/
│   │   │       ├── auth/
│   │   │       │   └── route.ts      # POST login
│   │   │       └── orders/
│   │   │           ├── route.ts      # GET list orders
│   │   │           └── [orderId]/
│   │   │               └── route.ts  # PATCH update status
│   │   └── admin/
│   │       └── [tenantSlug]/
│   │           ├── page.tsx          # Dashboard admin
│   │           ├── menu/
│   │           │   └── page.tsx      # Manajemen menu
│   │           └── layout.tsx
│   ├── lib/
│   │   ├── prisma.ts                 # Prisma client + tenant extension
│   │   ├── queue.ts                  # Queue & ETA calculation
│   │   └── auth.ts                   # Auth helpers (admin)
│   ├── components/
│   │   ├── MenuList.tsx
│   │   ├── OrderForm.tsx
│   │   ├── OrderStatusBadge.tsx
│   │   ├── OrderCard.tsx             # Untuk dashboard admin
│   │   └── QueueIndicator.tsx        # Estimasi antrian di halaman menu
│   └── types/
│       └── index.ts
├── docs/
│   └── PLAN.md                       # File ini
├── .env.example
├── .gitignore
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 9. API Endpoints (Draft)

### 9.1 Public

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/api/tenant/[slug]/menu` | List menu items (available only) |
| `POST` | `/api/order` | Create new order |
| `GET` | `/api/order/[orderId]` | Get order status + ETA |

### 9.2 Admin (Authenticated)

| Method | Path | Deskripsi |
|--------|------|-----------|
| `POST` | `/api/admin/auth` | Login (username + password) |
| `GET` | `/api/admin/orders` | List orders aktif (pending→ready) |
| `PATCH` | `/api/admin/orders/[orderId]` | Update status order |
| `GET` | `/api/admin/menu` | List all menu items |
| `POST` | `/api/admin/menu` | Create menu item |
| `PATCH` | `/api/admin/menu/[itemId]` | Update menu item |
| `DELETE` | `/api/admin/menu/[itemId]` | Delete menu item |
| `PATCH` | `/api/admin/settings` | Update tenant settings (jam, pause, dll) |

---

## 10. Risiko & Asumsi

### 10.1 Asumsi

| Asumsi | Dampak kalau salah |
|--------|-------------------|
| Customer punya smartphone + internet | Fundamental — tanpa ini platform useless. Asumsi aman (penetrasi smartphone Makassar tinggi) |
| Kedai bersedia monitor dashboard aktif | Perlu UI sederhana + notifikasi suara. Risiko: barista tidak lihat dashboard → order tidak terproses |
| Semua order pickup (no delivery) | Simplifikasi besar. Kalau nanti perlu delivery → arsitektur berubah signifikan |
| 1 tenant = 1 kedai fisik | Aman. Multi-cabang bisa jadi separate tenant |
| Pembayaran cash on pickup | Aman untuk MVP. Risiko: order fiktif (customer tidak datang ambil) |
| Menu item prep time bisa diperkirakan manual | ETA tidak akurat kalau estimasi salah. Perlu admin dashboard untuk adjust |
| Shared schema cukup untuk < 1000 tenant | Aman. Di atas 1000 tenant → perlu reevaluasi noisy neighbor |

### 10.2 Risiko

| Risiko | Severity | Mitigasi |
|--------|----------|----------|
| **Order fiktif / tidak diambil** | Medium | MVP: tidak ada charge. Post-MVP: payment upfront. Monitor rate order tidak diambil per tenant. |
| **Kedai tidak update status tepat waktu** | High | UI dashboard simple (drag-and-drop antar kolom status). Auto-reminder kalau order di satu status > N menit. |
| **ETA tidak akurat** | Medium | Transparansi: tampilkan "estimasi" bukan "janji". Admin bisa adjust prep time per item. Post-MVP: historical avg. |
| **Shared schema → data leak kalau query salah** | High | Prisma client extension mandatori. Integration test untuk verify isolasi tenant. Code review untuk semua raw query. |
| **Noisy neighbor (1 tenant rame ganggu tenant lain)** | Low | Aiven resource monitor. Post-MVP: connection pooling per tenant, read replicas. |
| **No.HP sebagai identitas → duplikasi** | Low | Phone bukan unique key. Customer bisa pesan >1×. Order lookup via order ID + phone. |
| **Vercel cold start (lambat)** | Low | Halaman menu statis (ISR). Edge functions untuk API ringan. |
| **Tanpa notifikasi → customer tidak tahu kopi siap** | Medium | Halaman status live (polling). Post-MVP: WhatsApp notifikasi. |

### 10.3 Key Metrics

| Metric | Target MVP | Cara Ukur |
|--------|-----------|-----------|
| Time-to-first-order (dari tenant daftar → order pertama) | < 10 menit | Timestamp diff |
| Order completion rate | > 95% (picked_up / total) | DB query |
| ETA accuracy | ± 5 menit dari actual ready time | Bandingkan ETA vs actual |
| Dashboard latency | < 2 detik (list orders) | Vercel Analytics |

---

## 11. Timeline Estimasi

| Fase | Durasi | Output |
|------|--------|--------|
| Setup repo + Prisma schema + seed | 1 hari | Repo, DB schema, seed data |
| Core API (order + menu + tenant) | 2 hari | Semua endpoint public + admin |
| Frontend public (menu + order + status) | 2 hari | Halaman customer flow |
| Dashboard admin | 2 hari | Manajemen order + menu |
| Queue & ETA calculation | 1 hari | Logika antrian + estimasi |
| Testing + bugfix | 1 hari | Test coverage critical path |
| **Total** | **~9 hari** | MVP siap pilot 1–2 kedai |

---

## 12. Next Steps

1. **Review PM** — feedback terhadap scope, flow, prioritas
2. **Buat repo GitHub** — `kopi-order` atau nama final
3. **Setup project** — Next.js + Prisma + Aiven DB
4. **Implementasi MVP** — sesuai timeline di atas
5. **Pilot** — 1–2 kedai di Makassar, feedback loop
6. **Iterasi** — WhatsApp notifikasi, payment, dll

---

> **Catatan:** Dokumen ini adalah PRD + technical plan draft. Belum final. Semua keputusan arsitektur (multitenancy model, stack, scope) terbuka untuk diskusi dan revisi setelah review PM.
