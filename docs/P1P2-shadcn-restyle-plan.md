# PLAN P1+P2: shadcn/ui restyle customer flow — dark-first

> **Baseline:** `feature/shadcn-p0-foundation` (PR #96, sha: fe6f58e) — shadcn new-york neutral tokens, 14 ui components, Plus Jakarta Sans, next-themes (default light), 238 vitest + 2 E2E green.
> **Kanon visual:** Stitch export (`~/Documents/orderin-stitch-design/`) — 6 screens mobile 390px dark-first + 2 desktop adaptasi.

---

## 1. Token Map: dark-first CSS vars

### globals.css rewrite (replace `:root`/`.dark` blocks)

```css
:root {
  --background: 0 0% 3.9%;       /* #0a0a0a */
  --foreground: 30 5% 91%;       /* #e5e2e1 (on-surface) */
  --card: 0 0% 10.2%;            /* #1a1a1a */
  --card-foreground: 30 5% 91%;
  --popover: 0 0% 10.2%;
  --popover-foreground: 30 5% 91%;
  --primary: 24 85% 53%;         /* #E87F24 */
  --primary-foreground: 30 87% 8%;
  --secondary: 0 0% 15%;         /* #262626 */
  --secondary-foreground: 30 5% 91%;
  --muted: 0 0% 11.8%;           /* surface-low #131313 */
  --muted-foreground: 0 0% 67%;  /* on-surface-variant #ACABAB */
  --accent: 0 0% 15%;
  --accent-foreground: 30 5% 91%;
  --destructive: 0 70% 45%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 15%;            /* #262626 */
  --input: 0 0% 15%;
  --ring: 24 85% 53%;            /* #E87F24 */
  --radius: 0.5rem;              /* 8px pills — cards use rounded-xl */
}
/* NO .dark block — single dark-first palette */
@media (prefers-color-scheme: light) {
  :root { /* light fallback: NOT in P1/P2 scope, defer to P4 */ }
}
```

### next-themes: default `dark`

`src/components/theme-provider.tsx`: `<ThemeProvider attribute="class" defaultTheme="dark">`

### Tailwind config: no change needed (already maps to `hsl(var(--...))`)

### Typography note
`globals.css` body already has `font-family: var(--font-plus-jakarta-sans)`. Add utility class for tabular-nums:
```css
.tabular-nums { font-variant-numeric: tabular-nums; }
```

---

## 2. P1 Breakdown: Shared Components

### 2.1 OrderStatusBadge → `src/components/OrderStatusBadge.tsx`
**Primitives:** `Badge` from `@/components/ui/badge`  
**Data contract:** `{ status: OrderStatus }` → warna + label + dot  
**Map (dark mode):**
| Status | Label | Style |
|---|---|---|
| PENDING | Menunggu konfirmasi | `bg-warning/10 text-warning border-warning/20` — amber/yellow dot |
| CONFIRMED | Dikonfirmasi | `bg-info/10 text-info border-info/20` — blue dot |
| BREWING | Sedang dibuat | `bg-primary/10 text-primary border-primary/20` — orange dot, animate-pulse |
| READY_FOR_PICKUP | Siap diambil | `bg-success/10 text-success border-success/20` — green dot |
| PICKED_UP | Selesai | `bg-muted text-muted-foreground border-border` |
| CANCELLED | Dibatalkan | `bg-destructive/10 text-destructive border-destructive/20` |

**Risiko:** status strings dipakai di E2E assertion (`Menunggu konfirmasi`, `Selesai`) — PASTIKAN label tidak berubah.  
**Jam:** 0.5h

### 2.2 QueueIndicator → `src/components/QueueIndicator.tsx`
**Primitives:** `Card` + conditional className  
**Data contract:** `{ queueSeconds: number, isOpen: boolean }`  
**Visual:** 3 state — closed (gray), empty queue (green), active queue (amber).  
**Map Stitch:** surface card bg `#1A1A1A`, border `#262626`, rounded-xl.  
**Risiko:** rendah — purely presentational, no E2E assertion.  
**Jam:** 0.5h

### 2.3 MenuList → `src/components/MenuList.tsx`
**Primitives:** `Button` (stepper), `Card` (item row)  
**Data contract:** `{ items: MenuItemView[], quantities: Record<string,number>, onQuantityChange }`  
**Map Stitch (menu.html):**
- Item card: `bg-surface rounded-xl border border-border p-md flex gap-md`
- Image: `w-20 h-20 object-cover rounded-lg border border-border`
- Price: `text-primary tabular-nums` (Rp format via formatRupiah)
- Description: `text-muted-foreground text-sm line-clamp-2`
- Add button: `bg-primary text-primary-foreground w-8 h-8 rounded-full`
- Stepper: `bg-muted rounded-full` with `+`/`−` buttons
**Risiko:** quantity stepper behavior testing — pastikan `onQuantityChange(id, qty±1)` tetap.  
**Jam:** 1h

### 2.4 OrderForm → `src/components/OrderForm.tsx`
**Primitives:** `Input`, `Button`, `Card`  
**Data contract:** `{ tenantSlug, items, isOpen, closedMessage? }` — submits POST /api/order, redirect /[slug]/order/[id]  
**Map Stitch:** cart bottom bar dari menu.html:
- Nama: `<Input>` with icon prefix (`person`)
- HP: `<Input>` with icon prefix (`call`)
- Cart total: `text-primary tabular-nums font-bold`
- Submit: `w-full bg-primary text-primary-foreground font-bold py-3.5 rounded-xl shadow-lg shadow-primary/20`
- Disabled state: `opacity-50 cursor-not-allowed`
**Risiko:** route redirect tetap `/${tenantSlug}/order/${orderId}` — E2E assertion. Customer auth session bind after order → cek regression.  
**Jam:** 1.5h

### 2.5 OrderCard (admin) → `src/components/OrderCard.tsx`
**Primitives:** `Card`, `Badge` (via AdminStatusBadge/PaymentBadge), `Button`  
**Data contract:** admin dashboard order card — lifecycle actions (mark paid, advance/regress status, cancel). PROPS TIDAK BOLEH BERUBAH.  
**Map Stitch (desktop/dashboard.html):**
- Card: `bg-surface rounded-xl border border-border p-3`
- Stuck highlight: `border-destructive ring-2 ring-destructive/20`
- Customer name: `text-foreground font-semibold`
- PIN: `text-primary tabular-nums`
- Items: list with `tabular-nums` prices
- Actions: `Button variant="outline"` for cancel, `Button variant="default"` for advance, `Button variant="secondary"` for mark paid
- Payment gate hint: `bg-primary/10 text-primary rounded p-2 text-xs`
**Risiko:** HIGH — admin workflow, drag-and-drop, sprint column. Banyak test yang assert element ini. Do NOT change data contract.  
**Jam:** 1.5h

### 2.6 OrderStatusTracker → `src/components/OrderStatusTracker.tsx`
**Primitives:** `Card`, `Badge` (via OrderStatusBadge), `Button`  
**Data contract:** `{ initial: OrderStatusView }` — polls GET /api/order/[orderId] every 5s, shows ETA, payment, PIN.  
**Map Stitch (status.html):**
- Order code: `text-primary font-bold tabular-nums tracking-wider` (center)
- Queue + ETA row: `bg-surface border border-border rounded-xl p-md` flex justify-between
- Timeline: vertical stepper with `bg-surface border border-border rounded-xl`
  - Completed: check icon in `bg-primary` circle
  - Active: `border-2 border-primary` ring, `text-primary font-bold`
  - Upcoming: `border-border`, `text-muted-foreground`
- PIN digits: `w-12 h-14 bg-[#1F2020] border border-[#262626] rounded-lg flex items-center justify-center`, `tabular-nums`
- Payment info: `bg-muted rounded-xl p-4` with QRIS details
- "Lihat riwayat" button: `bg-[#1F2020] border border-border rounded-lg text-primary font-semibold` (matches Stitch status.html line 254)
- "Saya sudah bayar" button: `bg-primary text-primary-foreground`
**Risiko:** polling behavior, PIN display, E2E assertion pada teks "Lihat riwayat pesananmu". Payment QRIS display must not break.  
**Jam:** 2h

### 2.7 StatusTimeline → `src/components/StatusTimeline.tsx`
**Primitives:** pure Tailwind (no shadcn primitive needed — simple vertical list)  
**Data contract:** `{ logs: StatusLogEntry[] }`  
**Map Stitch:** vertical stepper tanpa Card wrapper (dipakai di dalam OrderStatusTracker).  
- Dot: `w-2 h-2 rounded-full bg-muted-foreground` (completed), `bg-primary` (active)
- Connector line: `w-px bg-border`
- Labels: `text-foreground font-medium`, timestamps: `text-muted-foreground text-xs`
**Risiko:** rendah — presentational, dipakai OrderStatusTracker.  
**Jam:** 0.5h

### 2.8 CreateAccountBanner → `src/components/CreateAccountBanner.tsx`
**Primitives:** `Card`, `Input`, `Button`  
**Data contract:** `{ tenantSlug, customerName, customerPhone }` — inline register form di status page.  
**Map Stitch (register.html adaptations):**
- Banner card: `bg-surface border border-border rounded-xl p-4`
- CTA text: `Buat akun untuk simpan riwayat`
- Form: `Input` dengan icon prefix, `Button primary` for "Daftar"
- Error: `text-destructive text-xs`
- Success: `text-success text-sm`
**Risiko:** POST /api/customer/register — E2E assertion "Buat akun" mungkin muncul. Hydration gate (rate limit 60s/3).  
**Jam:** 1h

### 2.9 AccountOrdersList → `src/components/AccountOrdersList.tsx`
**Primitives:** `Card`, `Badge` (via OrderStatusBadge), `Button`  
**Data contract:** `{ tenantSlug }` — fetches GET /api/customer/orders, renders list of OrderSummary cards.  
**Map Stitch (history.html):**
- Active orders section: header `text-foreground font-bold text-lg`, cards `bg-surface rounded-xl border border-outline p-4`
- Order code: `text-primary font-bold tabular-nums`
- Status badge: via OrderStatusBadge
- Items summary: `text-foreground text-sm`
- Total: `text-foreground font-bold tabular-nums`
- "Pesan Lagi" button: `bg-muted hover:bg-surface-container-highest text-primary font-semibold py-3 rounded-lg border border-border` (matches Stitch history.html line 189-192)
- Completed section: same cards with `text-muted-foreground` subdued style
**Risiko:** E2E assertion on "Pesan Lagi" text. Loading state ("Memuat..."), empty state ("Belum ada pesanan").  
**Jam:** 1h

### 2.10 ActiveOrderBanner → `src/components/ActiveOrderBanner.tsx`
**Primitives:** plain Link + className  
**Data contract:** `{ tenantSlug }` — localStorage-based, renders or returns null.  
**Visual:** `bg-primary/10 border border-primary/20 rounded-xl p-3 text-primary` link
**Risiko:** rendah — localStorage only, no visual regression risk.  
**Jam:** 0.5h

### 2.11 OrderPersistence → `src/components/OrderPersistence.tsx`
**Primitives:** none (returns `null` — pure effect)  
**Data contract:** `{ orderId, slug }` — localStorage write on mount  
**Risiko:** NOL — invisible component.  
**Jam:** 0h (no visual change)

### 2.12 Admin components (P1 subset exposed to customer context)
**Admin components are P3** per proposal — customer flow only sees admin components via OrderCard (which is P1). Admin components (`AdminStatusBadge`, `PaymentBadge`, `StatusColumn`, `SprintDetail`, `SprintList`) deferred to P3. HOWEVER: OrderCard imports AdminStatusBadge + PaymentBadge → rewrite those two as part of P1 since OrderCard depends on them.  
**Jam:** 1h (AdminStatusBadge + PaymentBadge only)

### P1 Total: ~11h (12 tickets)

---

## 3. P2 Breakdown: Public Pages

### 3.1 `/` — Landing/Beranda → `src/app/page.tsx`
**Kanon Stitch:** `mobile/beranda.html`  
**Current state:** server-rendered tenant list (grid cards)  
**Changes:**
- Hero: heading `text-[32px] font-extrabold tracking-tight`, subtext `text-muted-foreground`
- Slug input: `Input` with `search` icon prefix, `placeholder="kopi-senja"`
- CTA: `Button` full-width, `variant="default"` (orange solid)
- Tenant grid: `Card` per tenant, shop name + address + status badge
- Link "Pemilik kedai? Masuk" → /register
**Risiko:** E2E happy-path starts from here → selector changes may break.  
**Jam:** 1.5h

### 3.2 `/[tenantSlug]` — Shop/Menu → `src/app/[tenantSlug]/page.tsx`
**Kanon Stitch:** `mobile/menu.html`  
**Current state:** server-rendered tenant info + QueueIndicator + ActiveOrderBanner + OrderForm (which embeds MenuList)  
**Changes:**
- Top bar: `sticky bg-background/90 backdrop-blur-md border-b border-border`, tenant name + status ("Buka"/"Tutup") + history icon link
- Category tabs: `sticky bg-background`, pill buttons `bg-muted rounded-lg` with active: `bg-primary text-primary-foreground`
- MenuList (rewritten in P1) renders cards
- Cart bottom bar: `fixed bottom-0 bg-background/95 backdrop-blur-lg border-t border-border` — total + "Buat Pesanan" button
- QueueIndicator placed above menu
**Risiko:** OrderForm behavior, cart state, API call POST /api/order unchanged. E2E assertion "Buat Pesanan".  
**Jam:** 2h

### 3.3 `/[tenantSlug]/order/[orderId]` — Order Status → `src/app/[tenantSlug]/order/[orderId]/page.tsx`
**Kanon Stitch:** `mobile/status.html`  
**Current state:** server fetches order, renders OrderStatusTracker + CreateAccountBanner  
**Changes:**
- Page chrome: header "Status Pesanan" with back arrow
- OrderStatusTracker (rewritten in P1) handles most UI
- CreateAccountBanner (rewritten in P1) shown conditionally for guest users
- Page-level padding + centering matching Stitch
**Risiko:** CreateAccountBanner conditional logic (guest vs logged in), E2E assertion "Lihat riwayat pesananmu".  
**Jam:** 1h

### 3.4 `/[tenantSlug]/account/orders` — Riwayat → `src/app/[tenantSlug]/account/orders/page.tsx`
**Kanon Stitch:** `mobile/history.html`  
**Current state:** server-rendered with session check, delegates to AccountOrdersList  
**Changes:**
- Header: "Riwayat Pesanan" with "← Kembali ke menu" link
- Sections: "Pesanan Aktif" + "Selesai" headings
- AccountOrdersList (rewritten in P1) handles list rendering
- Page-level bg + padding
**Risiko:** Session guard redirect (`verifyCustomerSession`), tenant isolation 404.  
**Jam:** 1h

### 3.5 Customer Login/Register — NO dedicated pages exist
**Current state:** Customer login is on the landing page (`/`), register is embedded in CreateAccountBanner (on status page). No standalone `/[tenantSlug]/login` or `/[tenantSlug]/register` pages.  
**Stitch has:** `mobile/login.html` + `mobile/register.html`  
**Decision:** P2 adds two new pages:
- `src/app/[tenantSlug]/login/page.tsx` — "Login untuk lihat riwayat" (Stitch login.html)  
  - Input: phone + password with icon prefixes
  - CTA: `Button primary "Masuk"`  
  - Secondary: "Lanjut sebagai tamu" + "Buat akun" link
- `src/app/[tenantSlug]/register/page.tsx` — "Buat Akun" (Stitch register.html)  
  - Input: nama, phone, password, konfirmasi password  
  - CTA: `Button primary "Daftar"`
  - Link: "Sudah punya akun? Masuk"
**Risiko:** New pages = new routes. Customer auth HMAC cookie unchanged (src/lib/customer-auth.ts). Backend API `/api/customer/login` + `/api/customer/register` already exist. E2E customer-account spec may need update.  
**Jam:** 2h (login 1h + register 1h)

### P2 Total: ~7.5h (5 tickets: beranda, shop, status, history, login+register)

---

## 4. Execution Order & Dependency Chain

```
P0 (done) → Token Map (1 ticket) → P1 components (12 tickets) → P2 pages (5 tickets)
```

**Dependency graph:**
```
Phase 0: Token Map         [1 ticket, 1h]    ← prereq for everything
Phase 1: OrderStatusBadge  [1 ticket, 0.5h]  ← no deps (leaf)
         QueueIndicator    [1 ticket, 0.5h]  ← no deps
         StatusTimeline    [1 ticket, 0.5h]  ← no deps
         OrderPersistence  [0 ticket]        ← skip
         ActiveOrderBanner [1 ticket, 0.5h]  ← no deps
         AdminStatusBadge  [1 ticket, 0.5h]  ← no deps (needed by OrderCard)
         PaymentBadge      [1 ticket, 0.5h]  ← no deps
Phase 2: MenuList          [1 ticket, 1h]    ← no deps (used by OrderForm)
         CreateAccountBan. [1 ticket, 1h]    ← no deps (used by status page)
         AccountOrdersList [1 ticket, 1h]    ← no deps (used by history page)
         OrderStatusBadge  ← already done
Phase 3: OrderCard         [1 ticket, 1.5h]  ← depends AdminStatusBadge + PaymentBadge
         OrderForm          [1 ticket, 1.5h]  ← depends MenuList
         OrderStatusTracker [1 ticket, 2h]    ← depends OrderStatusBadge + StatusTimeline
Phase 4: P2 Pages          [5 tickets, 7.5h] ← depends ALL P1 components complete
```

**Total: 17 tickets, ~18.5h (dengan parallel allowance: ~3 hari pioneer)**

**Parallel blocks:**
- Phase 0 → solo (1 ticket)
- Phase 1 → parallel (6 tickets, bisa dikerjakan bersamaan karena leaf components)
- Phase 2 → parallel (3 tickets, depend Phase 1 badges)
- Phase 3 → parallel (3 tickets, depend Phase 2)
- Phase 4 → parallel (5 pages, depend Phase 3)

---

## 5. Test Plan

### Vitest (238 tests — must stay green every phase)
- **Unit tests:** assert component behavior (data contract), NOT visual output. P1 rewrite tidak boleh mengubah props, hooks, atau event handler — hanya className/structure.
- **Snapshot tests:** akan fail setelah rewrite — update snapshots per phase. JANGAN skip.
- **Integration:** API route tests unaffected (no backend changes).

### E2E (Playwright — 3 specs on main, 4 di branch terbaru)
- `e2e/happy-path.spec.ts` — shop → order → status flow. Assertion text "Buat Pesanan", "Pesanan Diterima" harus tetap ada.
- `e2e/pickup-flow.spec.ts` — PIN flow. Assertion PIN digit display.
- `e2e/customer-account.spec.ts` (T17-13, PR #94) — register + history + login. Assertion "Buat akun", "Riwayat Pesanan", "Pesan Lagi", "Lihat riwayat pesananmu".

**E2E text assertions that MUST survive:**
| Text | Location | Phase risk |
|---|---|---|
| "Buat akun" | CreateAccountBanner button | P1 |
| "Buat Pesanan" | OrderForm submit / cart bar | P1 |
| "Lihat riwayat pesananmu" | OrderStatusTracker bottom button | P1 |
| "Pesan Lagi" | AccountOrdersList completed cards | P1 |
| "Riwayat Pesanan" | AccountOrdersPage heading | P2 |
| "Menunggu konfirmasi" | OrderStatusBadge PENDING label | P1 |
| "Selesai" | OrderStatusBadge PICKED_UP label | P1 |
| "Pesanan Diterima" | StatusTimeline / OrderStatusTracker step 1 | P1 |

**Strategy:** NEVER change Indonesian labels — only className/structure. Labels are the contract.

### Visual regression
- Compare screenshots against Stitch HTML ekspor per phase.
- P1: screenshot tiap komponen di Storybook-like isolated view.
- P2: screenshot tiap page di 390px width, dark mode.

---

## 6. Out of Scope (P3)

- Admin pages: `src/app/admin/[tenantSlug]/*` (dashboard, menu, settings, sprints)
- Admin components: `StatusColumn`, `SprintDetail`, `SprintList`
- Tailwind v4 upgrade
- Light mode proper (only dark-first now — light fallback skeleton in `:root` but no pixel-level design)
- Dark/light toggle placement (P4)
- Empty/loading/error states pass (P4)
- Backend/schema/API changes
- Info architecture redesign

---

## 7. Ticket Manifest (for PM to create)

| # | Ticket | Phase | Assignee | Est. |
|---|---|---|---|---|
| 1 | Token Map: dark-first CSS vars + next-themes default dark | 0 | pioneer | 1h |
| 2 | P1: OrderStatusBadge restyle | 1 | pioneer | 0.5h |
| 3 | P1: QueueIndicator restyle | 1 | pioneer | 0.5h |
| 4 | P1: StatusTimeline restyle | 1 | pioneer | 0.5h |
| 5 | P1: ActiveOrderBanner restyle | 1 | pioneer | 0.5h |
| 6 | P1: AdminStatusBadge + PaymentBadge restyle | 1 | pioneer | 1h |
| 7 | P1: MenuList restyle | 2 | pioneer | 1h |
| 8 | P1: CreateAccountBanner restyle | 2 | pioneer | 1h |
| 9 | P1: AccountOrdersList restyle | 2 | pioneer | 1h |
| 10 | P1: OrderCard restyle (admin) | 3 | pioneer | 1.5h |
| 11 | P1: OrderForm restyle | 3 | pioneer | 1.5h |
| 12 | P1: OrderStatusTracker restyle | 3 | pioneer | 2h |
| 13 | P2: Landing/Beranda page restyle | 4 | pioneer | 1.5h |
| 14 | P2: Shop/Menu page restyle | 4 | pioneer | 2h |
| 15 | P2: Order Status page restyle | 4 | pioneer | 1h |
| 16 | P2: Account Orders/History page restyle | 4 | pioneer | 1h |
| 17 | P2: Customer Login + Register pages (new) | 4 | pioneer | 2h |

**Total: 17 tickets, ~18.5h (~3 hari pioneer dengan parallel).**

---

## 8. PR Strategy

One PR per phase (4 PRs total): 
- **PR #1**: Token Map (ticket 1)
- **PR #2**: P1 batch (tickets 2–12)
- **PR #3**: P2 batch (tickets 13–17)
- **PR #4**: E2E fixup + snapshot update

Each PR gated on: `vitest run` green + `npx playwright test` green.
