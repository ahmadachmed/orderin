# T15 Sprint-based Board Retention + History Recap — Technical Plan

**Source**: Issue [#29](https://github.com/ahmadachmed/orderin/issues/29)
**Status**: Plan (implementasi belum dimulai)
**Verified against**: repo actual @ `main` (fc1099e), semua file:line dikutip dari kode real.

---

## Verifikasi Stack & File

| Komponen | File | Line/Detail |
|----------|------|-------------|
| Prisma 7 | `prisma/schema.prisma` | generator output = `../src/generated/prisma` |
| Tenant scoping | `src/lib/prisma.ts:112-190` | `scoped(tenantId)` via Proxy → inject `tenantId` ke where/data |
| Auth | `src/lib/auth.ts:61-63` | `getSession()` = HMAC cookie `orderin_admin_session`, **bukan NextAuth** |
| Board API | `src/app/api/admin/orders/route.ts:12-17` | `ACTIVE_STATUSES = [PENDING,CONFIRMED,BREWING,READY_FOR_PICKUP]` |
| Order mutation | `src/app/api/admin/orders/[orderId]/route.ts:23-30` | `ALLOWED_TRANSITIONS`, recalc ETA via `recalculateQueueEtas()` |
| Queue | `src/lib/queue.ts:26` | `QUEUE_STATUSES = ["PENDING","CONFIRMED","BREWING"]` |
| Queue ETA recalc | `src/lib/queue.ts:120-144` | `recalculateQueueEtas(db, tenantId, prepTimeBufferMinutes)` |
| Dashboard page | `src/app/admin/[tenantSlug]/page.tsx:158-161` | `STATUS_FLOW.map()` → group by status → render StatusColumn |
| Settings API | `src/app/api/admin/settings/route.ts:15-32` | `SETTINGS_SELECT` — saat ini **tidak ada field sprintDurationDays** |
| Settings page | `src/app/admin/[tenantSlug]/settings/page.tsx` | Hanya payment config (QRIS + bank), **belum ada input sprintDurationDays** |
| Admin API client | `src/lib/admin-api.ts:129-140` | `fetchSettings()` + `updateSettings()` |
| Admin types | `src/types/admin.ts:66-79` | `TenantSettings` — **tidak ada field sprintDurationDays** |
| Schema model Tenant | `prisma/schema.prisma:13-36` | `prepTimeBuffer Int @default(0)` — field terbaru, analogi untuk sprintDurationDays |
| Schema model Order | `prisma/schema.prisma:68-89` | 14 field, **tidak ada sprintId** |
| Testing | `vitest.config.ts` | node env, fileParallelism: false, 11 test file |
| Test helpers | `tests/helpers.ts` | `setupTenant()`, `cleanupTenant()`, `createOrderDirect()` |
| Styling | `src/app/globals.css` + Tailwind 3.4 | slate-100 bg, white/95 header, rounded-xl cards, border-slate-200 |
| Layout | `src/app/layout.tsx` | Geist font, `antialiased`, html lang="id" |
| Middleware | `src/middleware.ts` | `/api/:path*` matcher, rate limiting only |
| Dependencies | `package.json` | Next 14.2.35, Prisma 7.9.1, Vitest 4.1.10, Tailwind 3.4 — **zero dep baru diperlukan** |

---

## 1. Skema Migration (Prisma 7)

### 1.1 Enum baru

```prisma
// prisma/schema.prisma — after enum PaymentMethod (L135)

enum SprintStatus {
  OPEN
  CLOSED
}
```

### 1.2 Model Sprint (baru)

```prisma
// prisma/schema.prisma — after model OrderStatusLog (L115)

model Sprint {
  id        String       @id @default(uuid()) @db.Uuid
  tenantId  String       @db.Uuid
  tenant    Tenant       @relation(fields: [tenantId], references: [id])
  startAt   DateTime
  endAt     DateTime?
  status    SprintStatus @default(OPEN)
  closedAt  DateTime?
  createdAt DateTime     @default(now())

  orders    Order[]

  @@index([tenantId, status])
  @@unique([tenantId, status], name: "one_open_sprint_per_tenant")  // constraint aplikasi
}
```

**Constraint "one open sprint per tenant"**: Prisma tidak support partial unique index (PostgreSQL: `WHERE status = 'OPEN'`), jadi constraint ini **dienforce di application layer** via `findFirst({ where: { tenantId, status: "OPEN" } })` sebelum create. Unique komposit `[tenantId, status]` mencegah duplikat OPEN di level DB, tapi juga akan memblokir CLOSED kedua — jadi kita **tidak pakai `@@unique` composite**, cukup enforce di app layer. Alternatif: raw SQL partial unique index di migration manual.

### 1.3 Field baru di Tenant

```prisma
// prisma/schema.prisma — Tenant model, after prepTimeBuffer (L25)
  sprintDurationDays Int      @default(1)
```

### 1.4 Field baru di Order

```prisma
// prisma/schema.prisma — Order model, after updatedAt (L82)
  sprintId           String?   @db.Uuid

// Tambahkan relation:
  sprint             Sprint?   @relation(fields: [sprintId], references: [id])

// Tambahkan index baru:
  @@index([sprintId])
```

### 1.5 Migration commands

```bash
npx prisma migrate dev --name add_sprints
```

Migration file auto-generated oleh Prisma. Tidak perlu manual SQL kecuali partial unique index (opsional, bisa ditunda).

---

## 2. Endpoint Baru & Modifikasi

### 2.1 Endpoint baru

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/admin/sprints` | List semua sprint tenant (paginated, order by startAt desc) |
| `GET` | `/api/admin/sprints/[sprintId]` | Detail 1 sprint + semua order-nya (+ statusLogs, items) |
| `POST` | `/api/admin/sprints` | Buka sprint baru (auto-close sprint OPEN existing dulu) |
| `POST` | `/api/admin/sprints/[sprintId]/close` | Tutup sprint manual (carry-over logic) |

### 2.2 Endpoint dimodifikasi

| Method | Route | Perubahan |
|--------|-------|-----------|
| `GET` | `/api/admin/orders` | Filter tambahan: `sprintId: activeSprint.id` (bukan hanya ACTIVE_STATUSES). Order tanpa sprintId (legacy) ikut ditampilkan. |
| `POST` | `/api/order` | Auto-assign `sprintId` ke sprint OPEN tenant. Kalau belum ada sprint OPEN → auto-create sprint baru (`startAt = now()`). |
| `PATCH` | `/api/admin/orders/[orderId]` | Status transition ke PICKED_UP/CANCELLED: tetap seperti sekarang (keluar dari board, ETA = null). Tidak ada perubahan logic. |
| `GET` | `/api/admin/settings` | Tambah field `sprintDurationDays` di `SETTINGS_SELECT`. |
| `PATCH` | `/api/admin/settings` | Terima `sprintDurationDays` (integer 1-90), validasi. |

### 2.3 Detail implementasi endpoint

#### `GET /api/admin/sprints`

```typescript
// src/app/api/admin/sprints/route.ts
import { scoped } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = getSession();
  if (!session) return fail("Unauthorized", 401);

  const db = scoped(session.tenantId);
  const sprints = await db.sprint.findMany({
    orderBy: { startAt: "desc" },
    include: {
      _count: { select: { orders: true } },
    },
  });

  // Hitung omzet per sprint (Σ PAID) — on-the-fly, no aggregate table
  const result = await Promise.all(
    sprints.map(async (s) => {
      const paidOrders = await db.order.findMany({
        where: { sprintId: s.id, paymentStatus: "PAID" },
        include: { items: { select: { quantity: true, unitPrice: true } } },
      });
      const revenue = paidOrders.reduce(
        (sum, o) =>
          sum + o.items.reduce((s2, i) => s2 + Number(i.unitPrice) * i.quantity, 0),
        0
      );
      return {
        id: s.id,
        startAt: s.startAt,
        endAt: s.endAt,
        status: s.status,
        closedAt: s.closedAt,
        orderCount: s._count.orders,
        revenue,
      };
    })
  );

  return ok({ sprints: result });
}
```

#### `POST /api/admin/sprints` (open new sprint)

```typescript
// Flow:
// 1. Cari sprint OPEN existing → kalau ada, auto-close dulu
// 2. Close logic: carry-over orders
// 3. Create sprint baru OPEN
```

#### `POST /api/admin/sprints/[sprintId]/close` (close sprint)

```typescript
// Flow:
// 1. Validasi sprint exists + status OPEN + belongs to tenant
// 2. Fetch all orders in sprint
// 3. Carry-over logic (lihat section 3)
// 4. Update sprint: status=CLOSED, endAt=now(), closedAt=now()
```

#### Modifikasi `GET /api/admin/orders`

```typescript
// src/app/api/admin/orders/route.ts — line 19-32
// SEBELUM:
const orders = await scoped(session.tenantId).order.findMany({
  where: { status: { in: ACTIVE_STATUSES } },
  orderBy: { createdAt: "asc" },
  // ...
});

// SESUDAH:
const activeSprint = await db.sprint.findFirst({
  where: { status: "OPEN" },
});

const orders = await scoped(session.tenantId).order.findMany({
  where: {
    status: { in: ACTIVE_STATUSES },
    OR: [
      { sprintId: activeSprint?.id ?? "" },
      { sprintId: null }, // legacy orders tanpa sprint
    ],
  },
  orderBy: { createdAt: "asc" },
  // ...
});
```

#### Modifikasi `POST /api/order`

```typescript
// src/app/api/order/route.ts — setelah order dibuat, assign sprintId:
const sprint = await prisma.sprint.findFirst({
  where: { tenantId: tenant.id, status: "OPEN" },
});

let sprintId = sprint?.id;
if (!sprintId) {
  // Auto-create sprint
  const newSprint = await prisma.sprint.create({
    data: { tenantId: tenant.id, startAt: new Date(), status: "OPEN" },
  });
  sprintId = newSprint.id;
}

await prisma.order.update({
  where: { id: order.id },
  data: { sprintId },
});
```

### 2.4 Modifikasi `PATCH /api/admin/settings`

```typescript
// src/app/api/admin/settings/route.ts
// Di dalam PATCH handler, tambahkan validasi sprintDurationDays:
if (body.sprintDurationDays !== undefined) {
  const n = Math.floor(Number(body.sprintDurationDays));
  if (!Number.isFinite(n) || n < 1 || n > 90) {
    return fail("sprintDurationDays must be an integer 1-90", 400);
  }
  data.sprintDurationDays = n;
}
```

---

## 3. Sprint Lifecycle Logic

### 3.1 Auto-open

- **Trigger**: `POST /api/order` saat tidak ada sprint OPEN.
- **Atau**: first API call yang memerlukan sprint → auto-create.
- `startAt = now()`, `status = OPEN`.

### 3.2 Manual close

- **Trigger**: Barista klik "Tutup Shift" → `POST /api/admin/sprints/[sprintId]/close`.
- **Atau**: "Buka Shift Baru" → auto-close sprint existing + create baru.

### 3.3 Carry-over logic (on sprint close)

```
Untuk setiap order dalam sprint yang ditutup:
  IF status IN [PICKED_UP, CANCELLED]:
    → biarkan di sprint lama (archived)
  IF status IN [READY_FOR_PICKUP, PENDING, CONFIRMED, BREWING]:
    → pindahkan ke sprint baru (update sprintId)
    → jika status di QUEUE_STATUSES (PENDING/CONFIRMED/BREWING):
        → recalculateQueueEtas(db, tenantId, prepTimeBuffer)
```

**Implementasi**:

```typescript
// src/lib/sprint.ts — NEW
import { scoped } from "@/lib/prisma";
import { recalculateQueueEtas, QUEUE_STATUSES } from "@/lib/queue";
import type { PrismaClient } from "@/generated/prisma/client";

export async function closeSprint(
  tenantId: string,
  sprintId: string,
  prepTimeBuffer: number
): Promise<{ newSprintId: string; carriedOver: number; archived: number }> {
  const db = scoped(tenantId);

  // Create new sprint
  const newSprint = await (db.sprint as any).create({
    data: { startAt: new Date(), status: "OPEN" },
  });

  // Update closed sprint
  await (db.sprint as any).update({
    where: { id: sprintId },
    data: { status: "CLOSED", endAt: new Date(), closedAt: new Date() },
  });

  // Carry-over orders
  const { count: carriedOver } = await (db.order as any).updateMany({
    where: {
      sprintId,
      status: { in: ["READY_FOR_PICKUP", "PENDING", "CONFIRMED", "BREWING"] },
    },
    data: { sprintId: newSprint.id },
  });

  // ETA recalc untuk order yang masuk queue di sprint baru
  await recalculateQueueEtas(db, tenantId, prepTimeBuffer);

  // Count archived orders
  const archived = await (db.order as any).count({
    where: { sprintId, status: { in: ["PICKED_UP", "CANCELLED"] } },
  });

  return {
    newSprintId: newSprint.id,
    carriedOver,
    archived,
  };
}
```

### 3.4 Auto-close

**Out of scope** untuk iterasi ini. Disebutkan di issue: "auto-close cron" = out of scope. Hanya manual close.

---

## 4. UI: Halaman Riwayat Sprint

### 4.1 Route

`/admin/[tenantSlug]/sprints` — page baru.

### 4.2 Komponen

| Komponen | Path | Deskripsi |
|----------|------|-----------|
| `SprintList` | `src/components/admin/SprintList.tsx` | Tabel/list sprint: tgl, status badge, #order, omzet |
| `SprintDetail` | `src/components/admin/SprintDetail.tsx` | Detail 1 sprint: semua order + status + revenue |

### 4.3 Halaman

```
src/app/admin/[tenantSlug]/sprints/
  page.tsx        — list sprint (default view)
  [sprintId]/
    page.tsx      — detail sprint
```

### 4.4 Pola styling (consistent dengan existing admin pages)

- Header: `sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur`
- Judul: `text-lg font-bold text-slate-900`
- Subtitle: `text-xs text-slate-500`
- Nav tabs: `rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50`
- Cards: `rounded-xl border border-slate-200 bg-white p-4 shadow-sm`
- Button primary: `rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50`
- Error: `rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700`
- Success: `rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700`

### 4.5 Page: `/admin/[tenantSlug]/sprints` (list)

```typescript
// Data dari GET /api/admin/sprints
// Tampilan: tabel dengan kolom:
//   Tanggal Mulai | Status | #Order | Omzet (PAID) | Aksi
// Status badge: OPEN = badge emerald, CLOSED = badge slate
// Klik baris → navigasi ke /admin/[tenantSlug]/sprints/[sprintId]
// Tombol "Buka Sprint Baru" di header
```

### 4.6 Page: `/admin/[tenantSlug]/sprints/[sprintId]` (detail)

```typescript
// Data dari GET /api/admin/sprints/[sprintId]
// Tampilan:
//   - Header: tanggal sprint, status, durasi, carry-over count
//   - Ringkasan: total order, omzet (Σ PAID), cancel count, carry-over
//   - List order: grouped by status (PENDING→PICKED_UP + CANCELLED)
//   - Setiap order card: seperti di dashboard, tapi readonly (no drag)
// Jika sprint masih OPEN → tombol "Tutup Sprint"
```

### 4.7 Navigasi header dashboard

Tambahkan link "Riwayat" di header dashboard (`src/app/admin/[tenantSlug]/page.tsx` L173-193):

```tsx
<a
  href={`/admin/${tenantSlug}/sprints`}
  className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
>
  Riwayat
</a>
```

### 4.8 Config UI: `sprintDurationDays` di settings

Tambahkan input di halaman settings (`src/app/admin/[tenantSlug]/settings/page.tsx`):

```tsx
// Di dalam form, setelah section payment atau sebagai section baru:
<section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
  <h2 className="text-sm font-semibold text-slate-900">Durasi Sprint</h2>
  <p className="mt-0.5 text-xs text-slate-500">
    Satu sprint = satu periode retensi order. Board hanya menampilkan order sprint aktif.
  </p>
  <div className="mt-3">
    <label className="mb-1 block text-xs font-medium text-slate-600">
      Durasi sprint (hari)
    </label>
    <input
      type="number"
      min={1}
      max={90}
      value={String(form.sprintDurationDays)}
      onChange={(e) => set("sprintDurationDays", e.target.value)}
      className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
    />
    <p className="mt-1 text-xs text-slate-400">
      Default 1 hari. Berlaku untuk sprint berikutnya.
    </p>
  </div>
</section>
```

---

## 5. Strategi Testing

### 5.1 File test baru

| File | Jenis | Cakupan |
|------|-------|---------|
| `tests/sprint-lifecycle.test.ts` | Integration | Open sprint, close sprint, carry-over, ETA recalc, auto-create from order |
| `tests/sprint-api.test.ts` | Integration | GET/POST /api/admin/sprints, GET /api/admin/sprints/[id], POST close |
| `tests/sprint-board.test.ts` | Integration | GET /api/admin/orders now filters by sprintId |

### 5.2 Test cases spesifik

**`sprint-lifecycle.test.ts`**:
- Auto-create sprint saat order pertama dibuat (POST /api/order tanpa sprint OPEN → sprint terbuat)
- Close sprint → order PICKED_UP/CANCELLED tetap di sprint lama
- Close sprint → order READY_FOR_PICKUP/PENDING/CONFIRMED/BREWING carry-over
- Carry-over → ETA recalculated via recalculateQueueEtas
- Dua sprint CLOSED berturut-turut → tidak error
- Legacy order (sprintId = null) tetap muncul di board

**`sprint-api.test.ts`**:
- GET /api/admin/sprints → return list (termasuk sprint OPEN + CLOSED)
- GET /api/admin/sprints/[id] → return detail + orders
- POST /api/admin/sprints → create sprint baru, auto-close existing OPEN
- POST close → 404 untuk sprint non-existent
- POST close → 409 untuk sprint yang sudah CLOSED

**`sprint-board.test.ts`**:
- Order baru → assigned ke sprint OPEN
- Board hanya menampilkan order dari sprint OPEN + legacy
- Sprint CLOSED → order-nya hilang dari board (kecuali carry-over ke sprint baru)

### 5.3 Cara menjalankan

```bash
# Semua test
npm test

# Sprint-specific
npx vitest run tests/sprint-lifecycle.test.ts
npx vitest run tests/sprint-api.test.ts
```

### 5.4 Modifikasi test existing

- `tests/order-flow.test.ts`: tambahkan assertion bahwa order baru punya `sprintId`.
- `tests/helpers.ts`: `setupTenant()` — tambahkan field `sprintDurationDays` (default 1).
- `tests/helpers.ts`: `cleanupTenant()` — tambahkan cleanup Sprint model.

---

## 6. Breakdown Implementasi

| # | Ticket | Estimasi | Dependency | Assignee |
|---|--------|----------|------------|----------|
| T15-1 | Migration + model Sprint + Tenant.sprintDurationDays + Order.sprintId | 1h | — | pioneer |
| T15-2 | Sprint lifecycle logic (`src/lib/sprint.ts`) | 2h | T15-1 | pioneer |
| T15-3 | API: CRUD sprints + close endpoint | 2h | T15-2 | pioneer |
| T15-4 | Modifikasi GET /api/admin/orders + POST /api/order | 1.5h | T15-1 | pioneer |
| T15-5 | UI: Sprint list + detail page | 3h | T15-3 | pioneer |
| T15-6 | UI: sprintDurationDays di settings + nav "Riwayat" | 1.5h | T15-1 | pioneer |
| T15-7 | Tests: sprint-lifecycle + sprint-api + sprint-board | 2h | T15-3, T15-4 | pioneer |
| | **Total** | **~13h** | | |

**Urutan eksekusi**:
```
T15-1 (migration) → T15-2 (logic) → T15-3 (API)
                                   ↘ T15-4 (mod endpoint existing)
T15-3 → T15-5 (UI sprint pages)
T15-1 → T15-6 (UI settings)
T15-3 + T15-4 → T15-7 (tests)
```

---

## 7. Risk & Edge Cases

### 7.1 Interval > 1 hari

"Sprint hari ini" = sprint dengan status OPEN (bukan calendar day). Semua counter, recap, dan omzet adalah per-sprint, bukan per-hari.

### 7.2 Pindah `sprintDurationDays` mid-sprint

Tidak mempengaruhi sprint yang sedang berjalan. `sprintDurationDays` hanya dibaca saat **membuat sprint baru**. Documentasikan di UI: "Berlaku untuk sprint berikutnya."

### 7.3 Legacy order tanpa `sprintId`

Semua order yang dibuat sebelum migration akan punya `sprintId = null`. Board menampilkan order ini bersama order dari sprint aktif. Saat order di-pick-up/cancel → tetap null. Tidak perlu backfill — mereka akan naturally hilang dari board seiring waktu.

### 7.4 Tutup manual vs auto

Hanya manual close di v1. Auto-close cron out of scope. Kalau barista lupa close → sprint tetap OPEN, order dari 3 hari lalu masih di board. **Mitigasi**: dashboard menampilkan label "Sprint berjalan sejak <date>" sebagai reminder visual. Bisa ditambahkan di header board.

### 7.5 ETA recalc saat carry-over

`recalculateQueueEtas()` punya parameter `prepTimeBufferMinutes` (`src/lib/queue.ts:120-124`). Saat close sprint + carry-over, kita baca `Tenant.prepTimeBuffer` untuk parameter ini. ETA dihitung ulang berdasarkan posisi FIFO di sprint baru.

**Edge case**: jika sprint baru sudah ada order yang menunggu, order carry-over akan diletakkan di akhir queue (karena `createdAt` lebih lama dari order yang sudah ada di sprint baru). Ini **by design**: order carry-over tidak boleh memotong antrian order baru.

### 7.6 Concurrent sprint operations

Dua barista klik "Tutup Shift" bersamaan → race condition. **Mitigasi**: gunakan Prisma transaction atau optimistic locking. Sederhana: check `status === "OPEN"` sebelum update, lempar 409 kalau sprint sudah CLOSED.

### 7.7 `scoped()` untuk model Sprint

Sprint model punya `tenantId` → per `src/lib/prisma.ts:35` (`TENANT_SCOPED`), kita harus menambahkan `"Sprint"` ke `TENANT_SCOPED` dan `"sprint"` ke `SCOPED_DELEGATES`. Semua query Sprint harus via `scoped(tenantId)`.

### 7.8 Sprint tanpa order

Bisa terjadi kalau barista klik "Buka Shift Baru" tanpa ada order. Sprint dengan `_count.orders = 0` tetap ditampilkan di halaman riwayat (untuk audit trail).

---

## 8. File Manifest

### File baru
```
src/lib/sprint.ts                          — closeSprint(), getActiveSprint()
src/app/api/admin/sprints/route.ts         — GET + POST /api/admin/sprints
src/app/api/admin/sprints/[sprintId]/route.ts — GET /api/admin/sprints/[id]
src/app/api/admin/sprints/[sprintId]/close/route.ts — POST close
src/app/admin/[tenantSlug]/sprints/page.tsx — Sprint list page
src/app/admin/[tenantSlug]/sprints/[sprintId]/page.tsx — Sprint detail page
src/components/admin/SprintList.tsx         — Sprint list component
src/components/admin/SprintDetail.tsx       — Sprint detail component
tests/sprint-lifecycle.test.ts             — Integration: lifecycle
tests/sprint-api.test.ts                   — Integration: API
tests/sprint-board.test.ts                 — Integration: board filter
```

### File dimodifikasi
```
prisma/schema.prisma                       — Sprint model, enum, Tenant.sprintDurationDays, Order.sprintId
src/lib/prisma.ts                          — TENANT_SCOPED + SCOPED_DELEGATES + "Sprint"/"sprint"
src/app/api/admin/orders/route.ts          — Filter by sprintId
src/app/api/order/route.ts                 — Auto-assign sprintId
src/app/api/admin/settings/route.ts        — sprintDurationDays field
src/app/admin/[tenantSlug]/page.tsx        — Nav link "Riwayat" + sprint indicator
src/app/admin/[tenantSlug]/settings/page.tsx — sprintDurationDays input
src/types/admin.ts                         — Sprint types, TenantSettings.sprintDurationDays
src/lib/admin-api.ts                       — fetchSprints(), createSprint(), closeSprint()
tests/helpers.ts                           — Sprint cleanup, TenantOptions.sprintDurationDays
tests/order-flow.test.ts                   — Assert sprintId on new order
```

---

## 9. Konstrain Dipenuhi

- ✅ **Zero dependency baru** — semua pakai Prisma, Next.js, Vitest existing.
- ✅ **Semua test existing tetap hijau** — modifikasi minimal di helpers + order-flow test.
- ✅ **Bahasa kode = English** — semua komentar, nama fungsi, nama variabel.
- ✅ **Tidak push** — plan only, PM yang push dan buat PR.
- ✅ **Tidak ada NextAuth/User/lib-actions** — auth tetap HMAC cookie, scoped() tetap sama.
