# Multitenant Coffee Takeaway Ordering SaaS — PRD & Technical Plan

> **Status:** Draft — awaiting PM review  
> **Target:** Multitenant SaaS platform for coffee takeaway ordering  
> **Clients:** Coffee shops in Makassar (takeaway-only, no delivery)  
> **Repo:** Not created yet — folder structure planned below

---

## 1. Problem Statement

Takeaway coffee shops in Makassar face physical queue buildup during peak hours (morning 07:00–09:00, afternoon 12:00–14:00). Customers arrive at the same time, baristas get overwhelmed, customers wait a long time → poor experience → lost sales.

**Root cause:** Customers and shops have no pre-arrival communication mechanism. Customers don't know when their coffee is ready, and shops cannot manage their workload.

**Solution:** Order-ahead web platform — customers order from their phone, the system estimates the ready time, and customers arrive only when their coffee is already ready. No delivery (avoids logistics complexity + cost). Focus: reduce physical queues, increase shop throughput.

---

## 2. Multitenancy Model

### 2.1 Tradeoff Analysis

| Model | Pro | Con | Verdict |
|-------|-----|--------|---------|
| **Shared schema + tenant_id** | 1 DB, cheap, instant onboarding, simple queries | Data isolation via application layer (leak risk if there's a query bug), noisy neighbor at the DB level | ✅ **Choose this** |
| **Schema-per-tenant** | Strong isolation, easy per-tenant backup/restore | N tenants = N schemas, DB migration nightmare, complicated connection pooling, expensive on Aiven | ❌ Overkill for coffee shop scale |
| **Hybrid (shared + custom schema)** | Flexible | Double complexity, no clear use case in the MVP | ❌ YAGNI |

### 2.2 Decision: Shared Schema + Row-Level Isolation

- Every table has a `tenant_id` column (UUID, FK to `tenants`)
- **All queries are filtered `WHERE tenant_id = $currentTenantId`** — native PostgreSQL RLS cannot be used because Prisma does not support `SET LOCAL` / `app.current_tenant_id` at the connection level without raw queries. Alternative: Prisma middleware / client extension to inject `tenant_id` automatically.
- **Middleware pattern:**
  ```ts
  // lib/prisma.ts
  const prisma = new PrismaClient().$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (args.where && model !== 'Tenant') {
            args.where.tenantId = currentTenantId(); // from subdomain/slug
          }
          return query(args);
        },
      },
    },
  });
  ```
- Tenant routing via **subdomain** (`kedaiA.kopi.app`) or **path slug** (`kopi.app/s/kedaiA`). MVP uses slug — no wildcard DNS needed.

### 2.3 Tenant Onboarding

1. Shop registers via the landing page → gets a slug + subdomain
2. Shop admin fills in: shop name, address, operating hours, logo (optional)
3. Shop admin inputs the menu via the dashboard
4. Shop goes live immediately — customers can access via `kopi.app/s/<slug>`

---

## 3. Core Flow

```
[CUSTOMER]                              [SYSTEM]                            [SHOP/BARISTA]
    │                                       │                                      │
    ├─ Open kopi.app/s/<shop>               │                                      │
    ├─ View menu + queue estimate           │                                      │
    ├─ Pick items, enter name + phone no.   │                                      │
    ├─ Submit order ──────────────────────► │                                      │
    │                                       ├─ Create Order (status: pending)      │
    │                                       ├─ Calculate ETA from queue            │
    │                                       ├─ Send notif to shop dashboard ─────► ├─ See new order
    │                                       │                                      ├─ Confirm (→confirmed)
    │◄─── Show order status page ───────── ├─ Display ETA + live status           │
    │                                       │                                      ├─ Start brewing (→brewing)
    │                                       │                                      ├─ Finish (→ready_for_pickup)
    │◄─── "coffee ready" notification ──── ├─ Notify via WhatsApp (optional)       │
    │                                       │                                      │
    ├─ Arrive at shop, pick up coffee       │                                      ├─ Hand over (→picked_up)
```

### 3.1 Order Status (State Machine)

```
pending ──► confirmed ──► brewing ──► ready_for_pickup ──► picked_up
   │                                                              │
   └────────────────── cancelled (only from pending) ◄─────────────┘
```

- **pending:** Customer submitted, not yet confirmed by barista
- **confirmed:** Barista accepts the order, counted in the queue
- **brewing:** Barista starts the process
- **ready_for_pickup:** Coffee is ready, customer is notified
- **picked_up:** Customer picks up, order complete
- **cancelled:** Only possible from `pending` (no barista work yet)

### 3.2 Customer View (Public)

- Per-shop menu page (`/[tenantSlug]`)
- Display: shop name, menu items (name, price, estimated prep time), current queue status ("~15 minutes")
- Order form: pick items + qty, enter name + phone no.
- Status page: order ID, live status, estimated ready time
- **No login/register** — identification via phone no. + name (MVP)

### 3.3 Shop Dashboard (Admin)

- Login via magic link / OTP to phone no. (MVP: simple username + password)
- Dashboard: list of active orders (pending → ready), drag-and-drop to update status
- Menu management: MenuItem CRUD
- Operating hours: set open/close (orders outside hours automatically rejected)
- Toggle: accept orders / pause (if too busy)

---

## 4. Queue Management & Time Estimation

### 4.1 Simple Model (MVP)

```
ETA = Σ (prep_time_per_item × qty) for all orders in the queue before this order
    + (prep_time_per_item × qty for this order itself)
```

- Each `MenuItem` has `prep_time_seconds` (default 120s for standard coffee, can be set per item by the shop admin)
- FIFO queue per tenant — orders in the queue are processed in `confirmed` order
- ETA is recalculated every time an order finishes (`ready_for_pickup` / `picked_up`) or a new order comes in

### 4.2 ETA Formula

```
remaining_time_seconds = SUM(order_items × menu_item.prep_time_seconds)
                         for all orders with status IN (pending, confirmed, brewing)
                         created BEFORE this order
                         
current_order_eta = remaining_time_seconds + (order_items × menu_item.prep_time_seconds)
```

### 4.3 Anti-Overload

- **Pause orders:** Shop admin can pause acceptance of new orders (toggle in dashboard)
- **Order cap:** Maximum N orders in status `pending` + `confirmed` + `brewing` (default 20, configurable per tenant)
- **Operating hours:** Outside opening hours → reject orders, show "Closed — opens again at X"
- **Transparent ETA:** Customer sees the estimate before submitting → managed expectations

### 4.4 Future Enhancement (Post-MVP)

- Weighted prep time (hot vs cold drinks, single vs double shot)
- Barista capacity (N baristas = throughput × N)
- Historical average adjustment (light ML: actual vs estimated prep time)

---

## 5. Stack Recommendation

| Layer | Technology | Reason |
|-------|-----------|--------|
| **Frontend** | Next.js 14+ (App Router) | SSR/SSG for menu pages (shop SEO), RSC for realtime dashboard |
| **Language** | TypeScript (strict) | Type safety, same stack as project-one |
| **ORM** | Prisma | Type-safe, declarative migrations, client extension for multitenancy |
| **Database** | PostgreSQL (Aiven) | Managed, cheap from $19/mo, suitable for multitenant shared schema |
| **Deploy** | Vercel (Hobby/Pro) | Edge functions, auto-deploy, integrated with Next.js |
| **Styling** | Tailwind CSS | Utility-first, fast prototyping |
| **Realtime** | Vercel Edge Config + SWR polling (MVP) | Simple, no WebSocket. Post-MVP: Server-Sent Events |
| **Notifications** | WhatsApp Business API (post-MVP) | Main channel in Indonesia. MVP: status display on screen |
| **Auth** | next-auth (post-MVP) | MVP: simple session-based auth for shop admins |
| **Payment** | None in MVP | Cash on pickup |

### 5.1 Why Not...

| Alternative | Why Rejected |
|------------|----------------|
| **Supabase** | Good, but more expensive at scale and vendor lock-in. Standard Aiven Postgres, easy to migrate |
| **Django/Rails** | Full-stack JS is more efficient for a small team; Next.js handles frontend + API in 1 repo |
| **Microservices** | Overkill. Next.js monolith is enough for dozens-of-shops scale |
| **Firebase/Firestore** | NoSQL makes order-item-menu relations hard, complex data migration |

---

## 6. MVP Scope vs Later

### 6.1 MVP (v1.0)

| Feature | Detail |
|-------|--------|
| ✅ Landing page | List of shops, tenant registration |
| ✅ Per-tenant menu page | View-only, slug-based routing |
| ✅ Order without login | Enter name + phone no., submit order |
| ✅ Live order status | 5-second polling, displays ETA |
| ✅ Shop dashboard | Order list + status update, menu CRUD, operating hours |
| ✅ Queue & ETA | Simple FIFO calculation |
| ✅ Tenant admin login | Username + password (simple) |
| ✅ Pause/resume orders | Toggle in dashboard |

### 6.2 Post-MVP (v1.1+)

| Feature | Priority |
|-------|-----------|
| 🔜 WhatsApp notifications | High — main communication channel in Indonesia |
| 🔜 Customer order history | Medium — retention |
| 🔜 QR code pickup | Medium — pickup verification |
| 🔜 Menu image upload | Medium |
| 🔜 Multi-barista workflow | Low |
| 🔜 Payment integration (QRIS, GoPay) | Low — cash on pickup is enough |
| 🔜 Customer login + favorite orders | Low |

### 6.3 Explicitly Out of Scope

- ❌ Delivery/logistics (Gojek, Grab)
- ❌ Loyalty program / points
- ❌ Multi-branch management (1 tenant = 1 physical shop)
- ❌ Native mobile app (mobile-first web is enough)
- ❌ POS/QRIS integration

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

### 7.2 Prisma Schema

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
  prepTimeBuffer Int      @default(0)        // additional buffer minutes
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
  prepTimeSeconds Int    @default(120)       // estimated prep time per item
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
  etaSeconds    Int?          // estimated ready time in seconds (from now)
  etaCalculatedAt DateTime?   // when ETA was last calculated
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

Following the **all-UTC** pattern from project-one:
- All `DateTime` stored in UTC
- `openTime`/`closeTime` stored as `HH:mm` UTC (tenant is responsible for converting from local timezone when setting)
- ETA is calculated in seconds (duration), not absolute timestamp → not affected by timezone
- Timezone conversion only in the presentation layer

### 7.4 Index Strategy

```sql
-- Lookup tenant via slug (every request)
CREATE INDEX idx_tenant_slug ON "Tenant"("slug");

-- List menu per tenant
CREATE INDEX idx_menu_item_tenant ON "MenuItem"("tenantId");

-- List orders per tenant, sorted by time
CREATE INDEX idx_order_tenant_status ON "Order"("tenantId", "status", "createdAt");

-- Find order by customer phone
CREATE INDEX idx_order_phone ON "Order"("customerPhone");

-- Status log per order
CREATE INDEX idx_status_log_order ON "OrderStatusLog"("orderId");
```

---

## 8. Folder Structure (Planned)

```
kopi-order/
├── .github/
│   └── workflows/
│       └── ci.yml                    # Lint + type-check + build
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                       # Seed demo tenant + sample menu
├── public/
│   └── assets/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout
│   │   ├── page.tsx                  # Landing page (shop list)
│   │   ├── [tenantSlug]/
│   │   │   ├── page.tsx              # Shop menu (public)
│   │   │   ├── order/
│   │   │   │   └── [orderId]/
│   │   │   │       └── page.tsx      # Order status (public)
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
│   │           ├── page.tsx          # Admin dashboard
│   │           ├── menu/
│   │           │   └── page.tsx      # Menu management
│   │           └── layout.tsx
│   ├── lib/
│   │   ├── prisma.ts                 # Prisma client + tenant extension
│   │   ├── queue.ts                  # Queue & ETA calculation
│   │   └── auth.ts                   # Auth helpers (admin)
│   ├── components/
│   │   ├── MenuList.tsx
│   │   ├── OrderForm.tsx
│   │   ├── OrderStatusBadge.tsx
│   │   ├── OrderCard.tsx             # For the admin dashboard
│   │   └── QueueIndicator.tsx        # Queue estimate on the menu page
│   └── types/
│       └── index.ts
├── docs/
│   └── PLAN.md                       # This file
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

| Method | Path | Description |
|--------|------|-----------|
| `GET` | `/api/tenant/[slug]/menu` | List menu items (available only) |
| `POST` | `/api/order` | Create new order |
| `GET` | `/api/order/[orderId]` | Get order status + ETA |

### 9.2 Admin (Authenticated)

| Method | Path | Description |
|--------|------|-----------|
| `POST` | `/api/admin/auth` | Login (username + password) |
| `GET` | `/api/admin/orders` | List active orders (pending→ready) |
| `PATCH` | `/api/admin/orders/[orderId]` | Update order status |
| `GET` | `/api/admin/menu` | List all menu items |
| `POST` | `/api/admin/menu` | Create menu item |
| `PATCH` | `/api/admin/menu/[itemId]` | Update menu item |
| `DELETE` | `/api/admin/menu/[itemId]` | Delete menu item |
| `PATCH` | `/api/admin/settings` | Update tenant settings (hours, pause, etc.) |

---

## 10. Risks & Assumptions

### 10.1 Assumptions

| Assumption | Impact if wrong |
|--------|-------------------|
| Customers have smartphones + internet | Fundamental — without this the platform is useless. Safe assumption (high smartphone penetration in Makassar) |
| Shops are willing to actively monitor the dashboard | Need simple UI + sound notifications. Risk: barista doesn't see the dashboard → orders not processed |
| All orders are pickup (no delivery) | Major simplification. If delivery is needed later → architecture changes significantly |
| 1 tenant = 1 physical shop | Safe. Multi-branch can be separate tenants |
| Cash on pickup payment | Safe for MVP. Risk: fake orders (customer doesn't show up to pick up) |
| Menu item prep time can be estimated manually | ETA inaccurate if estimates are wrong. Need admin dashboard to adjust |
| Shared schema is enough for < 1000 tenants | Safe. Above 1000 tenants → need to re-evaluate noisy neighbor |

### 10.2 Risks

| Risk | Severity | Mitigation |
|--------|----------|----------|
| **Fake / unpicked-up orders** | Medium | MVP: no charge. Post-MVP: upfront payment. Monitor per-tenant unpicked-up order rate. |
| **Shop doesn't update status on time** | High | Simple dashboard UI (drag-and-drop between status columns). Auto-reminder if an order stays in one status > N minutes. |
| **Inaccurate ETA** | Medium | Transparency: show "estimate" not "promise". Admin can adjust prep time per item. Post-MVP: historical avg. |
| **Shared schema → data leak if a query is wrong** | High | Mandatory Prisma client extension. Integration tests to verify tenant isolation. Code review for all raw queries. |
| **Noisy neighbor (1 busy tenant affects others)** | Low | Aiven resource monitor. Post-MVP: per-tenant connection pooling, read replicas. |
| **Phone no. as identity → duplication** | Low | Phone is not a unique key. Customers can order more than once. Order lookup via order ID + phone. |
| **Vercel cold start (slow)** | Low | Static menu pages (ISR). Edge functions for lightweight APIs. |
| **No notifications → customer doesn't know coffee is ready** | Medium | Live status page (polling). Post-MVP: WhatsApp notifications. |

### 10.3 Key Metrics

| Metric | MVP Target | How to Measure |
|--------|-----------|-----------|
| Time-to-first-order (from tenant signup → first order) | < 10 minutes | Timestamp diff |
| Order completion rate | > 95% (picked_up / total) | DB query |
| ETA accuracy | ± 5 minutes from actual ready time | Compare ETA vs actual |
| Dashboard latency | < 2 seconds (order list) | Vercel Analytics |

---

## 11. Estimated Timeline

| Phase | Duration | Output |
|------|--------|--------|
| Repo setup + Prisma schema + seed | 1 day | Repo, DB schema, seed data |
| Core API (order + menu + tenant) | 2 days | All public + admin endpoints |
| Public frontend (menu + order + status) | 2 days | Customer flow pages |
| Admin dashboard | 2 days | Order + menu management |
| Queue & ETA calculation | 1 day | Queue + estimation logic |
| Testing + bugfix | 1 day | Critical path test coverage |
| **Total** | **~9 days** | MVP ready for 1–2 shop pilot |

---

## 12. Next Steps

1. **PM review** — feedback on scope, flow, priorities
2. **Create GitHub repo** — `kopi-order` or the final name
3. **Project setup** — Next.js + Prisma + Aiven DB
4. **Implement MVP** — per the timeline above
5. **Pilot** — 1–2 shops in Makassar, feedback loop
6. **Iterate** — WhatsApp notifications, payment, etc.

---

> **Note:** This document is a draft PRD + technical plan. Not final. All architectural decisions (multitenancy model, stack, scope) are open for discussion and revision after PM review.
