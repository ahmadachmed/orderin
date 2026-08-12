# T25: UX Hardening — Lookup Entry, Admin Language, Overnight Hours, Settings Form — PLAN v2

> **Executor:** @pioneer — execute task-by-task in order. Commit after each.
> **Repo:** ahmadachmed/orderin (branch: main, commit: d5c8324)
> **GitHub Issue:** https://github.com/ahmadachmed/orderin/issues/159
> **PM Scope Addenda:** Item 4 (admin settings form) — 2026-08-12

**Goal:** 4 UX fixes: order lookup entry on landing+shop, admin UI full Indonesian, overnight hours next-day marker, admin settings form for jam operasional.

**Changes from v1:** Item 4 added (admin settings), PM decisions applied (AdminStatusBadge → translate, Payment → Pembayaran), STATUS_LABELS exists → update not create.

---

## VERIFICATION SUMMARY

| Item | Priority | Root Cause | Approach |
|------|----------|-----------|----------|
| Lookup entry | HIGH | `POST /api/order/lookup` exists but only used via localStorage `ActiveOrderBanner` on shop page. No manual lookup entry point. | Add "Lacak Pesanan" button/CTA on landing + shop header, reuse existing API. Landing needs slug input (API requires `{phone, slug}`). |
| Admin language | HIGH | Admin UI English (dashboard, login, menu, settings, cards) vs customer pages Indonesian. Target: barista lokal. | Pure string replacement across 8 admin files + STATUS_LABELS update (existing map in types/admin.ts:93-100). AdminStatusBadge → translate per PM. |
| Overnight hours | MEDIUM | Landing card shows raw UTC (`Buka {openTime}–{closeTime} UTC`, ShopSearchForm.tsx:161). Shop page converts only for closed message. No next-day marker. | Convert landing to `formatTimeInTimezone`, add `isOvernightHours` detector + `formatOperatingHours()`, display "besok" marker. |
| Settings form | HIGH | API `PATCH /api/admin/settings` supports openTime/closeTime/timezone/isOpen/prepTimeBuffer/maxQueueSize (route.ts:35-113), but settings page only renders QRIS + bank + sprint — no form for jam operasional. Barista can't change hours from dashboard. | Add "Jam Operasional" section to settings page: openTime, closeTime (HH:mm), timezone (select/input), isOpen toggle, prepTimeBuffer, maxQueueSize. Reuse existing GET/PATCH. HH:mm validation already in API (route.ts:107-113). |

**No false positives.** All 4 gaps verified against live code at d5c8324.

---

## PER-ITEM PLAN

### ITEM 1: Order Lookup Entry Point (HIGH)

**Root cause:** `POST /api/order/lookup` (rate-limited 5/min per IP, src/app/api/order/lookup/route.ts) only consumed by `ActiveOrderBanner` (src/components/ActiveOrderBanner.tsx) which reads localStorage `orderin_orders` — passive, no manual input. If customer clears localStorage or uses different device, no way to find order.

**Constraint:** API requires `{phone: string, slug: string}` — tenant-scoped. Landing page has no slug context. NO backend change allowed.

**Approach:**

1. **Shop header** (has slug from URL params): "Lacak Pesanan" button in sticky header → opens inline modal/dialog with phone input → calls `POST /api/order/lookup` with `{phone, slug: tenantSlug}` → on success, redirect to `/[slug]/order/[orderId]`; on 404, show "Pesanan tidak ditemukan".

2. **Landing page** (no slug): "Lacak Pesanan" text link below hero section → scrolls to search grid with helper text "Cari kedai lalu gunakan tombol Lacak di halaman kedai". Minimal code, leverages existing flow.

**Recommendation:** Two-tier approach:
- Landing: text link CTA below hero (server component, static link + scroll anchor)
- Shop header: dedicated `OrderLookupForm` inline component (phone input + submit)

**Files changed:**
- **Modify:** `src/app/page.tsx` — add "Lacak Pesanan" CTA below hero section
- **Modify:** `src/app/[tenantSlug]/page.tsx` — render `<OrderLookupForm tenantSlug={tenantSlug} />` in header
- **New:** `src/components/OrderLookupForm.tsx` — client component: phone input + submit, calls POST /api/order/lookup, handles 200→redirect / 404→error / 429→rate limit
- **No change:** `src/components/ActiveOrderBanner.tsx` (keep existing localStorage banner, different use case)

**Test plan:**
- Unit: `OrderLookupForm` — renders phone input, submit button; fires POST with `{phone, slug}`; redirects on success; shows error on 404; shows rate-limit message on 429
- Unit: `OrderLookupForm` — trims phone, rejects empty input with validation message
- Integration: existing `tests/order-progress.test.ts` lookup tests cover API rate-limit, 404, tenant isolation
- E2E: shop page → klik "Lacak Pesanan" → masukkan nomor HP → redirect ke status page
- E2E: shop page → klik "Lacak Pesanan" → masukkan HP tanpa pesanan → "Pesanan tidak ditemukan"
- Snapshot: landing page renders "Lacak Pesanan" CTA

**Acceptance criteria:**
- [ ] Shop header has "Lacak Pesanan" button visible when tenant is open
- [ ] Click opens inline form with phone input (numeric, Indonesian phone format)
- [ ] Submit with valid phone+active order → redirect to `/[slug]/order/[orderId]`
- [ ] Submit with phone+no active order → "Pesanan tidak ditemukan untuk nomor ini"
- [ ] Submit with empty phone → validation error
- [ ] Rate limited: 6th request in 60s → "Terlalu banyak percobaan, coba lagi nanti"
- [ ] Landing page shows "Lacak Pesanan" CTA pointing users to shop search
- [ ] Existing ActiveOrderBanner (localStorage) unaffected
- [ ] No backend/API changes

---

### ITEM 2: Admin UI Language Consistency (HIGH)

**Root cause:** Admin pages written in English (developer default) while target users are Indonesian baristas. Customer pages already fully Indonesian. Inconsistency degrades UX.

**Discovery:** `src/types/admin.ts` already has `STATUS_LABELS` map (lines 93-100) with English labels — update, don't create. AdminStatusBadge has its own local `LABELS` (AdminStatusBadge.tsx:14-21) — both need translating.

**PM decisions (2026-08-12):**
1. AdminStatusBadge → TRANSLATE ke Indonesian. "Buka"/"Tutup" already used in landing cards — reuse same mapping.
2. Nav label "Payment" → "Pembayaran". Full Indonesian konsisten.

**Approach:** Pure string replacement — all user-visible English strings in admin pages → Indonesian. No logic, no component restructure, no behavior change.

**Translation of dynamic status labels** — update existing maps:

| English (current) | Indonesian (target) |
|---|---|
| Pending | Pending (same) |
| Confirmed | Dikonfirmasi |
| Brewing | Diracik |
| Ready | Siap Diambil |
| Picked up | Selesai |
| Cancelled | Dibatalkan |

Both `types/admin.ts:STATUS_LABELS` and `AdminStatusBadge.tsx:LABELS` get this update. Sentence case for Indonesian (not "SIAP DIAMBIL" all-caps — risk #4 from v1).

**Brand terms kept:** PIN, QRIS, Sprint, PAID/UNPAID, Menu, Riwayat.

| English | Indonesian | Rationale |
|---|---|---|
| Barista Dashboard | Dasbor Barista | "Dashboard" → "Dasbor" (KBBI) |
| Sign in / Admin login | Masuk / Login Admin | Consistent with customer pages |
| Signing in… | Sedang masuk… | |
| Menu management | Manajemen Menu | |
| Mark paid | Tandai Lunas | Matches PaymentBadge |
| Cancel | Batal | Already used in pickup modal |
| Delete | Hapus | |
| Edit | Ubah | |
| Save changes | Simpan | |
| Add item / + Add item | Tambah Item / + Tambah | |
| New item / Edit item | Item Baru / Ubah Item | |
| Available / Hidden | Tersedia / Tersembunyi | |
| Logout | Keluar | |
| Payment Config | Pengaturan Pembayaran | PM decision |
| Payment (nav) | Pembayaran | PM decision |
| Empty | Kosong | |
| No menu items yet | Belum ada item menu | |
| Delete this menu item? | Hapus item menu ini? | |
| Stuck >10m | Tertahan >10m | |
| No items | Tidak ada item | |
| ETA | Estimasi | |
| Session expired — redirecting… | Sesi berakhir — mengalihkan… | |
| Order moved to … | Pesanan dipindah ke … | |
| Order marked picked up | Pesanan ditandai selesai | |
| Payment marked PAID — brewing… | Pembayaran ditandai LUNAS — peracikan… | |
| Failed to load orders/menu/settings | Gagal memuat pesanan/menu/pengaturan | |
| Update/Save/Delete/Cancel failed | Gagal memperbarui/menyimpan/menghapus/membatalkan | |
| Table headers: Item, Price, Prep, Status, Actions | Item, Harga, Waktu, Status, Aksi | |
| Form labels: Name *, Price (IDR) *, Description, Prep time (seconds), Sort order | Nama *, Harga (IDR) *, Deskripsi, Waktu racik (detik), Urutan | |
| Nav links: Dashboard, Menu, Payment, Shop view, Riwayat | Dasbor, Menu, Pembayaran, Lihat Toko, Riwayat | "Menu", "Riwayat" unchanged |
| → confirmed/brewing/ready_for_pickup/picked_up | → dikonfirmasi/diracik/siap diambil/selesai | From STATUS_LABELS |
| 🔒 Mark payment PAID before brewing | 🔒 Tandai pembayaran LUNAS sebelum meracik | |
| Tip: drag a card to advance it… | Tip: seret kartu untuk majukan status… | |
| Only forward moves allowed… | Hanya maju yang diizinkan… | |
| Payment gate: mark order PAID… | Gerbang pembayaran: tandai LUNAS… | |

**Files changed (9 files, +1 from v1):**
- `src/types/admin.ts` — update `STATUS_LABELS` + `SPRINT_STATUS_LABELS` (Open→Buka, Closed→Tutup)
- `src/components/admin/AdminStatusBadge.tsx` — update local `LABELS` map (PM decision: translate)
- `src/app/admin/[tenantSlug]/page.tsx` — ~15 strings
- `src/app/admin/[tenantSlug]/login/page.tsx` — ~6 strings
- `src/app/admin/[tenantSlug]/menu/page.tsx` — ~20 strings
- `src/app/admin/[tenantSlug]/settings/page.tsx` — ~10 strings (title, nav, section headers, button)
- `src/app/admin/[tenantSlug]/sprints/page.tsx` — check + translate header/labels
- `src/components/OrderCard.tsx` — ~6 strings
- `src/components/admin/StatusColumn.tsx` — "Empty" → "Kosong"

**Files NOT changed (already Indonesian or correctly mixed):**
- Customer pages (already Indonesian)
- PaymentBadge.tsx (renders UNPAID/PAID — brand terms, keep English)
- SprintList.tsx (already Indonesian)

**Test plan:**
- Unit: `STATUS_LABELS` has all 6 OrderStatus keys with Indonesian values
- Unit: `AdminStatusBadge:LABELS` has all 6 keys with Indonesian values
- Snapshot: Admin dashboard renders "Dasbor Barista", "Tandai Lunas"
- Snapshot: Admin login renders "Masuk" button
- Snapshot: Menu page renders "Manajemen Menu", "Tambah Item", "Tersedia"/"Tersembunyi"
- Snapshot: OrderCard renders "Tandai Lunas", "→ dikonfirmasi"
- Snapshot: Settings nav renders "Pembayaran" (PM decision)
- E2E: complete admin flow — login → dashboard → advance order → all labels Indonesian
- E2E: menu CRUD — all labels Indonesian
- Regression: no behavior changes — status transitions, payment gate, PIN verification unchanged

**Acceptance criteria:**
- [ ] 100% admin UI Indonesian (except brand terms: PIN, QRIS, Sprint, PAID/UNPAID)
- [ ] Dynamic status labels Indonesian (→ dikonfirmasi, → diracik, → siap diambil)
- [ ] AdminStatusBadge labels Indonesian (PM decision)
- [ ] "Payment" nav → "Pembayaran", "Payment Config" → "Pengaturan Pembayaran" (PM decision)
- [ ] Form labels, table headers, buttons, nav all Indonesian
- [ ] Error messages (API + inline) Indonesian where user-facing
- [ ] No logic or behavior changes — pure string swap
- [ ] All existing admin tests pass without modification

---

### ITEM 3: Overnight Opening-Hours Display (MEDIUM)

**Root cause:** Two gaps:

**Gap A — Landing card shows raw UTC:** `ShopSearchForm.tsx:161` displays `Buka {t.openTime}–{t.closeTime} UTC`. After T21 added `formatTimeInTimezone`, the landing page was NOT updated — still shows raw UTC with "UTC" suffix. Landing page server (`page.tsx:16-27`) doesn't select `timezone`, so client can't convert.

**Gap B — No next-day marker:** `formatTimeInTimezone` (src/lib/time.ts:18-35) converts single UTC time to local timezone but doesn't detect overnight. Example: tenant openTime=22:00 closeTime=04:00 UTC → "Buka 05:00–11:00" (Asia/Jakarta) — not ambiguous here, but consider openTime=17:00 closeTime=03:00 UTC → "Buka 00:00–10:00" — looks same-day but is actually next-day.

**Approach:**

1. **Add `timezone` to landing page data fetch** — `src/app/page.tsx` select `timezone: true`, add to `ShopTenant` interface, pass to `ShopSearchForm`.

2. **Add `isOvernightHours(openUtc, closeUtc, timezone)` to `src/lib/time.ts`** — converts both to timezone and checks if close < open post-conversion. Pure function, no side effects.

3. **Add `formatOperatingHours(openUtc, closeUtc, timezone)` to `src/lib/time.ts`** — returns `{openDisplay, closeDisplay, isOvernight}`. Uses existing `formatTimeInTimezone` internally.

4. **Update `ShopSearchForm`** — use `formatOperatingHours` instead of raw `{t.openTime}–{t.closeTime} UTC`. Display: `Buka 05:00–11:00` (normal) or `Buka 22:00–05:00 besok` (overnight).

5. **Update shop page `[tenantSlug]/page.tsx`** — add operating hours display in header (currently only Buka/Tutup badge). Show: `Buka 05:00–11:00` or `Buka 22:00–05:00 besok`.

6. **Remove duplicate `isWithinHours`** — shop page has a local copy. Replace with import from `lib/time.ts`.

**Marker wording:** "besok" (lowercase, after close time) — `Buka 22:00–05:00 besok`. No parentheses.

**Files changed:**
- **Modify:** `src/lib/time.ts` — add `isOvernightHours()` + `formatOperatingHours()`; export both
- **Modify:** `src/app/page.tsx` — add `timezone: true` to prisma select
- **Modify:** `src/components/ShopSearchForm.tsx` — add `timezone` to `ShopTenant` interface; use `formatOperatingHours` in display
- **Modify:** `src/app/[tenantSlug]/page.tsx` — import `isWithinHours` from lib/time (remove duplicate); add operating hours display to header
- **Modify:** `tests/time-format.test.ts` — add tests for `isOvernightHours` + `formatOperatingHours`
- **Modify:** `tests/components/ShopSearchForm.test.tsx` — update fixtures to include `timezone`

**Test plan:**
- Unit: `isOvernightHours("22:00", "04:00", "Asia/Jakarta")` → `true` (22→05, 04→11, 11>05, overnight)
- Unit: `isOvernightHours("07:00", "21:00", "Asia/Jakarta")` → `false` (07→14, 21→04, 04<14, overnight? actually 04<14 means NOT overnight — wait, close=04 vs open=14, close < open → overnight! But this is Jakarta vs UTC+7. Let me recalculate: open 07:00 UTC → 14:00 WIB. close 21:00 UTC → 04:00 WIB next day. So yes this IS overnight for Jakarta. But the original tenant is 07-21 UTC which for Indonesia = 14-04, which IS overnight. OK this is correct.)
- Unit: `isOvernightHours("01:00", "13:00", "Asia/Jakarta")` → `false` (01→08, 13→20, 20>08, same day)
- Unit: `formatOperatingHours("22:00", "04:00", "Asia/Jakarta")` → `{openDisplay: "05:00", closeDisplay: "11:00", isOvernight: true}`
- Unit: `isWithinHours` still works for overnight ranges (existing test)
- Snapshot: ShopSearchForm renders "Buka 05:00–11:00 besok" for overnight tenant
- Snapshot: ShopSearchForm renders "Buka 08:00–20:00" for normal tenant
- Snapshot: Shop page header shows operating hours with marker
- Integration: shop page — tenant with overnight hours → displays marker correctly
- Integration: landing card — same tenant → displays with marker

**Acceptance criteria:**
- [ ] Landing card shows hours in tenant timezone, not raw UTC
- [ ] Overnight hours show "besok" marker (e.g., "Buka 05:00–11:00 besok")
- [ ] Normal hours show no marker (e.g., "Buka 08:00–20:00")
- [ ] Shop page header shows operating hours (new display)
- [ ] `isWithinHours` logic unchanged — already correct for overnight
- [ ] Duplicate `isWithinHours` in shop page removed — imports from lib/time.ts
- [ ] Graceful fallback when timezone is null/invalid → shows raw UTC + "UTC" suffix
- [ ] No regression on existing queue/order time checks

---

### ITEM 4: Admin Settings — Jam Operasional Form (HIGH) ★ NEW v2

**Root cause:** `PATCH /api/admin/settings` (route.ts:62-143) fully supports `openTime`, `closeTime`, `timezone`, `isOpen`, `prepTimeBuffer`, `maxQueueSize` — all in `TenantSettings` type. `fetchSettings()` returns them. `updateSettings()` accepts `Partial<TenantSettings>`. But the settings page (src/app/admin/[tenantSlug]/settings/page.tsx) only renders:
- QRIS (image URL + static code)
- Bank Transfer (bank name + account number)
- Sprint Duration

Barista/owner can't change jam buka, timezone, isOpen, prepTimeBuffer, or maxQueueSize from dashboard — must use API/DB manually.

**HH:mm validation already exists** at route.ts:107-113 (`/^\d{2}:\d{2}$/`). No backend validation change needed.

**Storage decision:** `openTime`/`closeTime` stored "HH:mm" UTC (consistent with schema comment, PLAN §7.3 all-UTC). Settings page displays them converted to tenant's timezone using `formatTimeInTimezone` (from Item 3 work). Saves raw UTC — same as current API behavior, zero backend change.

**Approach:**

1. **Extend `FormState`** in settings page — add `openTime`, `closeTime`, `timezone`, `isOpen`, `prepTimeBuffer`, `maxQueueSize`.

2. **Add "Jam Operasional" section** — input fields:
   - `openTime` (time input, HH:mm, placeholder "07:00")
   - `closeTime` (time input, HH:mm, placeholder "21:00")
   - `timezone` (text input with auto-complete/datalist of common IANA timezones, placeholder "Asia/Jakarta")
   - `isOpen` (toggle/checkbox, labeled "Buka"/"Tutup")
   - `prepTimeBuffer` (number input, 0-600, label "Buffer waktu racik (menit)")
   - `maxQueueSize` (number input, 1-1000, label "Maks antrean")

3. **Client-side validation:**
   - `openTime`/`closeTime`: match `/^\d{2}:\d{2}$/` (HH:mm). API already validates — client-side catches before submit.
   - `timezone`: required, validate against `Intl.supportedValuesOf("timeZone")` or accept any non-empty string (API validates at DB level if we add Prisma constraint; for now accept valid IANA string)
   - `prepTimeBuffer`: integer 0-600
   - `maxQueueSize`: integer 1-1000

4. **Load + save** — extend `load()` to populate new fields from `fetchSettings()`. Extend `save()` to include new fields in `updateSettings()` patch.

5. **Timezone display preview** — next to timezone input, show current UTC times converted: "contoh: 07:00 UTC → 14:00 WIB". Uses `formatTimeInTimezone` from lib/time.ts.

**Files changed:**
- **Modify:** `src/app/admin/[tenantSlug]/settings/page.tsx` — add "Jam Operasional" section with 6 new fields; extend `FormState`, `load()`, `save()`, `set()`
- **No change:** `src/lib/admin-api.ts` (updateSettings already handles Partial<TenantSettings>)
- **No change:** `src/app/api/admin/settings/route.ts` (PATCH already supports all fields, HH:mm validated)
- **No change:** `src/types/admin.ts` (TenantSettings already has all fields)

**Test plan:**
- Unit: settings page renders "Jam Operasional" section with 6 fields
- Unit: settings page loads openTime/closeTime/timezone/isOpen from GET response
- Unit: settings page sends all fields on PATCH save
- Unit: client-side HH:mm validation shows error on "25:00", "abc"
- Unit: client-side maxQueueSize rejects <1 or >1000
- Unit: client-side prepTimeBuffer rejects <0 or >600
- Snapshot: settings page — "Jam Operasional" section visible
- E2E: admin login → settings → change openTime → save → verify GET returns new value

**Acceptance criteria:**
- [ ] Settings page has "Jam Operasional" section with: openTime, closeTime, timezone, isOpen, prepTimeBuffer, maxQueueSize
- [ ] Fields pre-populated from GET /api/admin/settings on load
- [ ] Save sends all fields to PATCH /api/admin/settings
- [ ] HH:mm validation on openTime/closeTime (client-side, before submit)
- [ ] timezone field accepts valid IANA timezone string
- [ ] isOpen toggle works (checkbox/switch)
- [ ] prepTimeBuffer accepts 0-600
- [ ] maxQueueSize accepts 1-1000
- [ ] Success message after save ("✓ Tersimpan")
- [ ] Error display on API/PATCH failure
- [ ] Existing payment config + sprint sections unaffected
- [ ] Zero backend/API change — reuse existing PATCH route

---

## PM DECISIONS (resolved)

| Question | Decision | Source |
|----------|----------|--------|
| AdminStatusBadge — translate? | YES — translate ke Indonesian. "Buka"/"Tutup" mapping dari landing card. | PM 2026-08-12 |
| "Payment" nav label — "Pembayaran" atau keep? | "Pembayaran". Full Indonesian. | PM 2026-08-12 |

**All PM decisions applied:** AdminStatusBadge translated, Payment → Pembayaran, Payment Config → Pengaturan Pembayaran.

---

## OPEN QUESTIONS RESOLVED

| Question | Answer | Rationale |
|----------|--------|-----------|
| Lookup placement: landing + shop header? | Landing: CTA link to search grid. Shop: inline form in header. Shared component: `OrderLookupForm` (shop only). | Landing has no slug; forcing dual-input (phone+slug) there is bad UX. Defer to shop page where slug is known. |
| Multi active order per phone? | Redirect langsung ke latest active. List view deferred. | API returns single latest active order by design (`orderBy: {createdAt: "desc"}, take: 1`). Multi-order list needs API change → out of scope. |
| Admin translation: full Indonesian? | Yes, with exceptions: PIN, QRIS, Sprint, PAID/UNPAID, Menu, Riwayat. | Brand terms + universal tech terms kept. "Dashboard" → "Dasbor" per KBBI. |
| Marker wording: "besok" vs "(besok)"? | `Buka 22:00–05:00 besok` — no parentheses. | Clean, readable, consistent with Indonesian date conventions. |
| Settings hour storage: UTC or local? | UTC (unchanged — HH:mm UTC). Settings page converts for display via `formatTimeInTimezone`. | Consistent with PLAN §7.3 all-UTC. Zero backend change. |

---

## DEPENDENCY GRAPH & EXECUTION ORDER

```
Phase 1 (no dependencies, can parallelize)
├── T25-1: Admin language — update STATUS_LABELS + SPRINT_STATUS_LABELS
├── T25-2: Overnight hours — isOvernightHours + formatOperatingHours in lib/time.ts
└── T25-4: Lookup — OrderLookupForm component

Phase 2 (depends on Phase 1)
├── T25-3: Admin language — all page/component string swaps (depends on T25-1)
├── T25-5: Overnight hours — landing card + shop page display (depends on T25-2)
├── T25-6: Lookup — integration into shop header + landing CTA (depends on T25-4)
└── T25-10: Settings form — add "Jam Operasional" section (depends on T25-2 for formatTimeInTimezone)

Phase 3 (tests, can start after Phase 2)
├── T25-7: Unit tests — formatOperatingHours + STATUS_LABELS
├── T25-8: Component tests — ShopSearchForm overnight, OrderLookupForm
├── T25-9: E2E — lookup, admin language, overnight
├── T25-11: Unit tests — settings form validation, HH:mm, bounds
└── T25-12: E2E — settings jam operasional flow
```

---

## PIONEER TASK BREAKDOWN

| # | Task | Est. (hrs) | Files | Depends On |
|---|------|------------|-------|------------|
| T25-1 | Update STATUS_LABELS + SPRINT_STATUS_LABELS to Indonesian | 0.25 | src/types/admin.ts | — |
| T25-2 | Add isOvernightHours + formatOperatingHours to lib/time.ts | 0.5 | src/lib/time.ts | — |
| T25-3 | Admin language: translate 9 files (all pages + components) | 2.0 | 6 page files + OrderCard + StatusColumn + AdminStatusBadge | T25-1 |
| T25-4 | Create OrderLookupForm component | 1.0 | new src/components/OrderLookupForm.tsx | — |
| T25-5 | Overnight hours: update landing + shop page display | 1.0 | page.tsx, ShopSearchForm.tsx, [tenantSlug]/page.tsx | T25-2 |
| T25-6 | Lookup: integrate into shop header + landing CTA | 0.75 | page.tsx, [tenantSlug]/page.tsx | T25-4 |
| T25-7 | Unit tests: formatOperatingHours, STATUS_LABELS | 0.5 | tests/time-format.test.ts, tests/admin-types.test.ts | T25-1, T25-2 |
| T25-8 | Component tests: ShopSearchForm, OrderLookupForm | 1.0 | tests/components/ShopSearchForm.test.tsx, tests/components/OrderLookupForm.test.tsx | T25-4, T25-5 |
| T25-9 | E2E: lookup + admin language + overnight | 1.5 | e2e/lookup.spec.ts, e2e/admin-language.spec.ts | T25-3, T25-5, T25-6 |
| T25-10 | Settings form: add "Jam Operasional" section (6 fields) | 1.5 | src/app/admin/[tenantSlug]/settings/page.tsx | T25-2 |
| T25-11 | Unit tests: settings form validation (HH:mm, bounds, toggle) | 0.5 | tests/admin-settings.test.tsx | T25-10 |
| T25-12 | E2E: settings jam operasional — change, save, verify | 0.75 | e2e/admin-settings.spec.ts | T25-10 |

**Total: ~12.25 hours** (12 tasks, up from 9)

**Recommended execution order:**
```
T25-1 + T25-2 + T25-4 (parallel)
→ T25-3 + T25-5 + T25-6 + T25-10 (parallel after dependencies)
→ T25-7 + T25-8 + T25-11 (tests, parallel)
→ T25-9 + T25-12 (E2E, final)
```

T25-3 can start immediately after T25-1 (types update). T25-10 can start after T25-2 (uses formatTimeInTimezone for preview).

---

## RISKS & TRADE-OFFS

1. **Lookup — landing without slug:** Current design defers lookup to shop page. If PM wants landing-direct lookup, need either: (a) new API without slug requirement, or (b) dual-input form. Both add complexity. Current approach is MVP-safe.

2. **Lookup — phone format:** Indonesian numbers can be 08xx or +62. API stores `customerPhone` as raw string. Lookup form should accept both, trim, and pass as-is. No normalization needed (exact match in DB).

3. **Admin language — regression risk:** Pure string changes, zero logic changes. Risk near zero. Snapshot tests may break (expected) — update as part of T25-3.

4. **AdminStatusBadge translation:** Badge currently renders all-caps English ("READY"). With sentence-case Indonesian ("Siap Diambil"), badge text will be longer. CSS: no change needed — badge auto-sizes.

5. **Overnight hours — timezone fallback:** If tenant has no timezone set, `formatOperatingHours` falls back to raw UTC with "UTC" suffix (existing `formatTimeInTimezone` behavior on invalid timezone).

6. **Duplicate isWithinHours:** Shop page has local copy. Replace with lib/time.ts import — function is identical, no behavioral difference.

7. **Settings form — field overload:** Adding 6 fields to settings page is a lot. Consider splitting "Jam Operasional" into a collapsible section or sub-page. For v2 plan: all in one page, grouped under a clear section header. If page becomes too long, split in future iteration.

8. **Settings form — timezone input:** IANA timezone list is huge (~400 entries). For v2, use text input with datalist of common Indonesian timezones (Asia/Jakarta, Asia/Makassar, Asia/Jayapura, Asia/Singapore) + free-text for others. Not a select dropdown.

9. **Settings form — save scope:** Currently `save()` sends ALL fields in patch. With 6 new fields, it still sends all. API ignores undefined fields. No change to save semantics.

---

## OUT OF SCOPE (explicit)

- Menu image upload (proposal terpisah — issue #159 mentions this as separate)
- Test-data cleanup
- a11y semantic pass (separate concern, needs dedicated audit)
- Backend/API changes — zero allowed per task spec
- Multi-order list per phone (needs API change — future iteration)
- Landing direct lookup without slug (needs API change — future iteration)
- Admin settings: logo upload, address, phone (different concern)
- Timezone-aware `isOpen` on landing page (landing uses `tenant.isOpen` DB boolean — computed per-tenant, not time-sensitive. Different concern from overnight display.)
- Settings page UI restructure / tab layout (if page becomes too long, defer to future PR)
