# T18: UX Gap-Fix PLAN

Repo: `~/documents/bukan_project/orderin` | HEAD: d5c8324 | Issue: #145

---

## FALSE POSITIVE (1 gap)

### SEARCH-01 — Search by name already implemented ✅

**Claim**: "Landing search label 'Masukkan Nama Kedai' tapi cuma normalizeSlug->router.push('/<slug>'). Tidak ada lookup."

**Evidence**: Code at `src/components/ShopSearchForm.tsx:68-98` already implements hybrid name+slug lookup, merged in PR #144 (4dc1330):

```tsx
// line 82-89
const exact = tenants.filter(
  (t) => t.slug === slug || t.name.toLowerCase() === q
);
if (exact.length === 1) {
  setError(null);
  router.push(`/${exact[0].slug}`);  // ← real DB slug, NOT normalized input
  return;
}
```

- **Slug match**: `t.slug === slug` — typing "kopi-senja" → direct match
- **Name match**: `t.name.toLowerCase() === q` — typing "Kopi Senja Makassar" → exact name match → redirect to real slug "kopi-senja"
- **Partial match**: keeps filtered grid visible, no redirect
- **Zero match**: inline "Kedai tidak ditemukan" alert

**Test confirmation** (`tests/components/ShopSearchForm.test.tsx:139-146`):
```
it("redirects to /[slug] on submit with an exact name match (case-insensitive)"
→ push("/kopi-senja") for value "KOPI SENJA"
```

**Seed data**: tenant `name: "Kopi Senja Makassar"`, `slug: "kopi-senja"`. Typing "Kopi Senja Makassar" → `t.name.toLowerCase() === "kopi senja makassar"` → true → redirect to `exact[0].slug` = "kopi-senja" ✓

**Verdict**: Auditor likely tested before PR #144 was merged, or didn't re-test after the fix. NO WORK NEEDED.

---

## CONFIRMED GAPS (5 gaps, ~7.5h total)

### GAP 1: QUEUE-01 (HIGH) — Queue position not shown on status page (~3h)

**Root cause**: `etaForOrderInQueue()` (`src/lib/queue.ts:56-66`) already computes FIFO index (`idx`) internally but only returns ETA seconds. The `idx` value (which is the 0-based position) is discarded. `OrderStatusView` (`src/types/index.ts:65-87`) has no `queuePosition` field. `GET /api/order/[orderId]` (`src/app/api/order/[orderId]/route.ts:76-107`) never computes or returns position. `OrderStatusTracker.tsx` only renders ETA (line 141-154).

**Approach**: Add position computation alongside existing ETA in the API route. Expose via new field in `OrderStatusView`. Render in status tracker.

**Files changed**:
1. `src/lib/queue.ts` — add `queuePositionForOrder()` export (or modify `etaForOrderInQueue` to return both)
2. `src/types/index.ts` — add `queuePosition: number | null` to `OrderStatusView`
3. `src/app/api/order/[orderId]/route.ts` — compute `queuePosition` in GET handler
4. `src/components/OrderStatusTracker.tsx` — render position badge/row (e.g., "Antrean ke-3")
5. `src/app/[tenantSlug]/order/[orderId]/page.tsx` — pass `queuePosition` through server-side initial render

**Test plan**:
- Unit: `queue.test.ts` — add `queuePositionForOrder` tests (returns 1-based position, null for non-queue statuses)
- Unit: `OrderStatusTracker.test.tsx` — verify position rendered when available, hidden when null
- E2E: `happy-path.spec.ts` — verify "Antrean ke-N" appears on status page after order creation

**AC**:
- Status page shows "Antrean ke-N" when order is in queue (PENDING/CONFIRMED/BREWING)
- Position updates as orders ahead leave the queue (via 5s polling)
- Position hidden when order is READY_FOR_PICKUP/PICKED_UP/CANCELLED
- "Antrean ke-1" (not "ke-0" — 1-based)

---

### GAP 2: ACCT-03 (MEDIUM) — Silent redirect from riwayat link without session (~1.5h)

**Root cause**: `src/app/[tenantSlug]/account/orders/page.tsx:16` does `redirect(`/${tenantSlug}`)` when no customer session. No query param, no toast/message. Link source: `OrderStatusTracker.tsx:308` ("Lihat riwayat pesananmu") and shop page header `[tenantSlug]/page.tsx:105` (History icon).

**Approach**: Redirect to login page with `?next=account/orders` param. Login page already exists at `/[tenantSlug]/login/`. After successful login, redirect to the `next` target.

**Files changed**:
1. `src/app/[tenantSlug]/account/orders/page.tsx` — `redirect(`/${tenantSlug}/login?next=account/orders`)
2. `src/app/[tenantSlug]/login/page.tsx` — read `next` search param, redirect there after login (line 38 currently hardcodes `account/orders`)
3. May need: toast notification in account page explaining why redirected (or use search param `?redirected=login-required`)

**Test plan**:
- Unit: `account/orders` page — mock no session, verify redirect URL includes `?next=`
- Unit: login page — verify `router.push` uses `next` param when present
- E2E: `customer-account.spec.ts` — guest clicks "Lihat riwayat" → lands on login → after login → back to riwayat

**AC**:
- Guest clicking "Lihat riwayat pesananmu" → redirected to `/[slug]/login?next=account/orders`
- After login → redirected to `/[slug]/account/orders`
- No silent redirect — user sees login page with context ("Login untuk lihat riwayat")

---

### GAP 3: LAND-01 (MEDIUM) — Landing page shows raw UTC time (~1.5h)

**Root cause**: `ShopSearchForm.tsx:161` renders `Buka {t.openTime}–{t.closeTime} UTC` using raw DB values. `ShopTenant` interface (line 36-44) lacks `timezone` field. `src/app/page.tsx` (landing server component) selects `openTime`/`closeTime` but NOT `timezone` from Tenant. The helper `formatTimeInTimezone()` (`src/lib/time.ts:18-35`) already exists and is used by shop page `[tenantSlug]/page.tsx:70`.

**Approach**: Add `timezone` to `ShopTenant` (mirroring `TenantSummary` in types), select it in landing page query, convert times with `formatTimeInTimezone` in the tenant card.

**Files changed**:
1. `src/components/ShopSearchForm.tsx` — add `timezone?: string` to `ShopTenant` interface, convert display using `formatTimeInTimezone`
2. `src/app/page.tsx` — add `timezone: true` to tenant select
3. `src/types/index.ts` — add `timezone?: string` to `TenantSummary` for consistency

**Test plan**:
- Unit: `ShopSearchForm.test.tsx` — verify tenant card shows converted time (not raw UTC)
- Unit: `time-format.test.ts` — existing tests for `formatTimeInTimezone` already cover conversion

**AC**:
- Landing tenant card shows "Buka 15:00–05:00" for Asia/Makassar (UTC+8) tenant, not "Buka 07:00-21:00 UTC"
- Falls back to raw UTC if timezone is null/undefined (graceful)
- Shop page continues to work unchanged

---

### GAP 4: STATUS-05 (LOW) — Timeline shows misleading "Pesanan dibuat" for PAID log (~1h)

**Root cause**: `StatusTimeline.tsx:4-11` maps `STATUS_LABELS` strictly by `status` field. When admin marks payment as PAID, the statusLog entry has `status: "PENDING"` (the order's status at the time) but `note: "Marked PAID via dashboard"` and `actorName: "admin"`. The timeline renders this as "Pesanan dibuat" — the same label as the order-creation log, creating a duplicate/misleading entry.

**Approach**: Enrich the label logic: when `l.status === "PENDING"` AND `l.note` contains "PAID" (marker), render a payment-specific label like "Pembayaran diterima" instead of "Pesanan dibuat". Or render `l.note` as subtitle/description instead of changing the label.

**Files changed**:
1. `src/components/StatusTimeline.tsx` — add conditional label logic or render note text below label for payment events
2. `src/app/api/order/[orderId]/route.ts` — optionally add an `eventType` field to statusLogs (e.g., "status" vs "payment") for cleaner separation

**Test plan**:
- Unit: `StatusTimeline` — render with a PAID log entry, verify label is NOT "Pesanan dibuat"
- Unit: `OrderStatusTracker.test.tsx` — verify timeline entries for PAID events render correctly

**AC**:
- PAID log entry shows "Pembayaran diterima" or note text, NOT "Pesanan dibuat"
- Timeline no longer shows duplicate "Pesanan dibuat" entries when payment is marked
- Backward compatible — existing non-PAID PENDING logs still show "Pesanan dibuat"

**Simpler alternative** (preferred): Instead of changing the label, render the `note` field as a secondary line below the status label. "Pesanan dibuat" with "Marked PAID via dashboard" below is clear. Change: add `{l.note && <p className="text-xs text-muted-foreground mt-0.5">{l.note}</p>}` after line 33 in StatusTimeline.tsx.

---

### GAP 5: STATUS-06 (LOW) — ETA still shown when order is READY_FOR_PICKUP (~0.5h)

**Root cause**: `OrderStatusTracker.tsx:141` condition checks `!TERMINAL_STATUSES.has(order.status)` where `TERMINAL_STATUSES = new Set(["PICKED_UP", "CANCELLED"])`. READY_FOR_PICKUP is not in this set. The API already sets `etaSeconds = 0` for READY (route.ts:64-65), and `formatDuration(0)` returns `"<1 menit"`, so the UI shows "Estimasi siap: <1 menit dari sekarang" — confusing because the order IS already ready.

**Approach**: Add `READY_FOR_PICKUP` to the ETA hide condition. Since `etaSeconds` is already 0 for READY, the simplest fix is adding `order.status !== "READY_FOR_PICKUP"` to the condition.

**Files changed**:
1. `src/components/OrderStatusTracker.tsx:141` — add `order.status !== "READY_FOR_PICKUP"` to the ETA visibility condition

**Test plan**:
- Unit: `OrderStatusTracker.test.tsx` — verify ETA hidden when status is READY_FOR_PICKUP
- Unit: verify ETA still shown for PENDING/CONFIRMED/BREWING

**AC**:
- READY_FOR_PICKUP: no ETA shown (only pickup code card)
- PENDING/CONFIRMED/BREWING: ETA still shown as before
- PICKED_UP/CANCELLED: no ETA (unchanged)

---

## PHASE ORDER (dependency graph)

```
Phase 1 (parallel, ~2h) — LOW priority, no deps:
├── STATUS-06 (0.5h) — 1 file, 1 line
├── STATUS-05 (1h)   — 1 file, add note rendering
└── LAND-01 (1.5h)   — 3 files, timezone on landing

Phase 2 (~1.5h) — MEDIUM, no deps:
└── ACCT-03 (1.5h) — 2 files, redirect + login param

Phase 3 (~3h) — HIGH, largest surface:
└── QUEUE-01 (3h) — 5 files, full-stack (types → API → UI)
```

## PIONEER TICKET BREAKDOWN

| # | Ticket | Hours | Phase | Deps |
|---|--------|-------|-------|------|
| T19 | QUEUE-01: Antrean position on status page | 3h | 3 | none (parallel OK) |
| T20 | ACCT-03: Login redirect for riwayat link | 1.5h | 2 | none |
| T21 | LAND-01: Timezone display on landing | 1.5h | 1 | none |
| T22 | STATUS-05: Fix PAID log timeline label | 1h | 1 | none |
| T23 | STATUS-06: Hide ETA at READY_FOR_PICKUP | 0.5h | 1 | none |

**Total: 7.5h** (~1 day pioneer).

Recommended dispatch order: T19 (QUEUE-01, biggest) + T21 (LAND-01) + T23 (STATUS-06) in parallel first wave; T20 + T22 second wave.

## OUT OF SCOPE (verified OK, JANGAN sentuh)

- SEARCH-02 (low, custom 404 page) — NOT in this task's gap list
- Search input form/handler — already functional (PR #144)
- Admin 5s polling — verified working
- Barista card #CODE+PIN — verified working
- statusLogs timeline render — verified working (minus STATUS-05 fix)
- Re-entry localStorage + /api/order/lookup + register link order by phone — verified working
- Cancel flow — verified working
- Sprint/menu/payment config — verified working
- TenantSummary.timezone addition for LAND-01 — add only to ShopTenant (internal) + landing select, NOT to TenantSummary in types/index.ts (separate concern)
