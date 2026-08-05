# T16: Order Progress Visibility + Pickup Identity Verification — PLAN

> **Executor:** @pioneer — execute task-by-task in order. Commit after each.
> **Repo:** ahmadachmed/orderin (branch: main, commit: 81c9378)
> **GitHub Issue:** https://github.com/ahmadachmed/orderin/issues/42
> **Audit CSV:** docs/test-audit-scenarios.csv (83 scenarios, PR #41 merged)

**Goal:** Close 5 audit gaps in order progress visibility and pickup verification.

---

## VERIFICATION SUMMARY

| Gap | Severity | Status | Evidence |
|-----|----------|--------|----------|
| CUST-02 | HIGH | **CONFIRMED** | No localStorage anywhere. No phone-lookup endpoint. `@@index([customerPhone])` exists in schema but unused. |
| PICKUP-01 | HIGH | **CONFIRMED** | OrderCard.tsx:72-76 shows name+phone only. OrderStatusTracker.tsx:109-111 shows `#XXXXXXXX` code — not mirrored. PATCH READY_FOR_PICKUP→PICKED_UP (route.ts:23-30) has zero verification gate. |
| CUST-01 | MEDIUM | **CONFIRMED** | GET /api/order/[orderId] (route.ts:19-79) returns no `statusLogs`. Admin PATCH (route.ts:162-199) includes `statusLogs` in response. |
| PICKUP-02 | MEDIUM | **CONFIRMED** | Subset of PICKUP-01. OrderCard never renders order ID or code. Fix is display-only — merge with PICKUP-01. |
| CUST-03 | LOW | **CONFIRMED** (not false positive) | OrderStatusTracker.tsx:12 `TERMINAL_STATUSES` includes `READY_FOR_PICKUP`; lines 36-38 clear interval. PICKED_UP after READY never propagates. |

**No false positives.** All 5 gaps verified against live code.

---

## PER-GAP PLAN

### GAP 1: CUST-02 — Re-entry after URL loss (HIGH)

**Root cause:** Order access is UUID-only fire-and-forget. No durable identifier stored client-side. No server-side lookup by phone. User closes tab → loses order ID forever.

**Approach:** Two-pronged defense:
1. **Client persistence:** Save `{orderId, slug}` to `localStorage` on order create + on order status page mount. On `/` (menu page) load, check localStorage for active orders and render a "Lanjutkan pesanan" banner linking back to status page.
2. **Server lookup endpoint:** `POST /api/order/lookup` — accepts `{phone, slug}`, returns the most recent non-terminal order for that phone-scoped to tenant. Rate-limited (5 req/min per IP, 10 req/min per phone). Uses existing `@@index([customerPhone])`.

**Files changed:**
- **New:** `src/app/api/order/lookup/route.ts` — POST endpoint, phone→latest active order
- **Modify:** `src/components/OrderForm.tsx` — save `{orderId, slug, timestamp}` to localStorage after successful POST
- **Modify:** `src/app/[tenantSlug]/page.tsx` (menu page) — read localStorage, render "Lanjutkan pesanan" banner
- **Modify:** `src/app/[tenantSlug]/order/[orderId]/page.tsx` — on mount, save to localStorage
- **Modify:** `src/lib/rate-limit.ts` — add `lookupByPhone` rate limit key (or reuse existing token-bucket pattern)

**Test plan:**
- Unit: `POST /api/order/lookup` returns 200 + orderId for active order, 404 for terminal, 404 for unknown phone
- Unit: rate-limit blocks after 5 req/min (per IP) and 10 req/min (per phone)
- Unit: cross-tenant isolation — phone from tenant A doesn't leak tenant B orders
- Integration: localStorage persists across tab close → menu page shows banner → click navigates to status page
- Integration: localStorage cleared when order reaches terminal (PICKED_UP/CANCELLED) via polling cleanup

**Acceptance criteria:**
- [ ] Customer places order → closes tab → reopens menu page → sees "Lanjutkan pesanan" banner
- [ ] Banner links to correct status page with live polling
- [ ] `POST /api/order/lookup` returns orderId for active orders only
- [ ] Rate-limited to prevent phone enumeration
- [ ] Existing order flow unaffected (no regression)

---

### GAP 2: PICKUP-01 — Pickup identity verification (HIGH)

**Root cause:** No verification gate between READY_FOR_PICKUP and PICKED_UP. Anyone knowing the customer name can claim the order. The 8-char code displayed to customer (#XXXXXXXX) is NOT shown on the barista card — no cross-check possible.

**Approach:** Generate a 4-digit pickup PIN at order creation time. Display it on both customer status page AND barista OrderCard. Require PIN entry in the admin UI before transitioning READY_FOR_PICKUP→PICKED_UP. Store as `pickupCode` on Order model.

**Files changed:**
- **New:** `prisma/migrations/*_add_pickup_code.sql` — or alter schema
- **Modify:** `prisma/schema.prisma` — add `pickupCode String @default("")` to Order model (4-digit, generated at create)
- **Modify:** `src/app/api/order/route.ts` (POST) — generate 4-digit random PIN on order create
- **Modify:** `src/app/api/order/[orderId]/route.ts` (GET customer) — include `pickupCode` in response
- **Modify:** `src/app/api/admin/orders/[orderId]/route.ts` (PATCH) — require `pickupCode` in request body when transitioning READY_FOR_PICKUP→PICKED_UP; reject with 403 if wrong
- **Modify:** `src/components/OrderStatusTracker.tsx` — display 4-digit PIN prominently in READY_FOR_PICKUP section
- **Modify:** `src/components/OrderCard.tsx` — display 4-digit PIN next to customer name (barista side)
- **Modify:** Admin dashboard page (the board) — add PIN input modal/field on "→ PICKED_UP" action

**Test plan:**
- Unit: PIN generated as 4-digit random (0000-9999) on order create
- Unit: PATCH READY_FOR_PICKUP→PICKED_UP with wrong PIN → 403 + does not transition
- Unit: PATCH READY_FOR_PICKUP→PICKED_UP with correct PIN → 200 + transition succeeds + statusLog records
- Unit: PIN visible in customer GET response and admin GET response
- Integration: complete flow — customer places order → sees PIN → barista sees PIN on card → barista enters PIN → PICKED_UP
- Integration: wrong PIN denied; 3 wrong attempts → should not lock (keep simple)

**Acceptance criteria:**
- [ ] 4-digit PIN generated per order at creation
- [ ] PIN displayed on customer status page and barista OrderCard
- [ ] Barista MUST enter correct PIN to mark PICKED_UP
- [ ] Wrong PIN returns 403; order stays READY_FOR_PICKUP
- [ ] PIN not leaked in URL or console logs
- [ ] Existing status transitions (PENDING→CONFIRMED→BREWING→READY) unaffected

**Design note:** 4 digits is enough for a coffee shop — collision risk is negligible within a sprint's active orders (~20-50). The PIN is a verification aid, not a cryptographic secret. Barista manually enters it; UX is a 4-digit input with Enter to confirm.

---

### GAP 3: CUST-01 — Status timeline for customer (MEDIUM)

**Root cause:** GET /api/order/[orderId] returns only current `status` string. `OrderStatusLog` rows exist in DB with actorType/actorName/timestamps but are never included in the customer-facing API response.

**Approach:** Include `statusLogs` array in the customer GET endpoint response. Render a vertical timeline component in OrderStatusTracker showing each status change with timestamp and actor (e.g., "Dikonfirmasi oleh barista • 14:32").

**Files changed:**
- **Modify:** `src/app/api/order/[orderId]/route.ts` — `include: { statusLogs: { orderBy: { createdAt: "asc" } } }` + map to response
- **Modify:** `src/components/OrderStatusTracker.tsx` — add timeline section between status badge and items list, using `order.statusLogs`
- **New (optional):** `src/components/StatusTimeline.tsx` — reusable timeline component (recommended for cleanliness)

**Test plan:**
- Unit: GET customer order returns `statusLogs[]` with all expected fields (status, actorType, actorName, createdAt)
- Unit: Timeline renders all log entries in ascending time order
- Unit: Newest entry matches current order.status
- Integration: full flow — create order → advance statuses → customer sees growing timeline
- Snapshot: component renders correctly for 0 logs (legacy), 1 log, 5+ logs

**Acceptance criteria:**
- [ ] Customer status page shows chronological timeline of all status changes
- [ ] Each entry shows: status label (Indonesian), actor name, timestamp
- [ ] Timeline reflects real-time updates (polling includes new log entries)
- [ ] No breaking change to existing API response shape (additive only)
- [ ] Backward-compatible: orders without statusLogs (pre-migration) show empty state

---

### GAP 4: PICKUP-02 — Order code on barista dashboard (MEDIUM)

**Root cause:** OrderCard renders customer name + phone (lines 72-76) but never the order ID or short code. The customer sees `#XXXXXXXX` (8-char uppercase prefix) but barista can't correlate.

**Approach:** Add `orderId.slice(0, 8).toUpperCase()` display to OrderCard, formatted as `#XXXXXXXX`. This is the cheapest fix — a single line addition. Merged into PICKUP-01 implementation since both touch OrderCard.

**Files changed:**
- **Modify:** `src/components/OrderCard.tsx` — add order code display near customer name

**Note:** This is a subset of PICKUP-01. After PICKUP-01 is done, the OrderCard will show the 4-digit PIN instead of (or alongside) the 8-char code. Recommendation: implement both display elements — 4-digit PIN for verification + 8-char code for reference.

---

### GAP 5: CUST-03 — Polling stops at READY_FOR_PICKUP (LOW)

**Root cause:** `TERMINAL_STATUSES` set (line 12) includes `READY_FOR_PICKUP`, so `clearInterval(timer)` fires when order reaches that state (lines 36-38). When barista later marks PICKED_UP, the page is frozen and never updates.

**Approach:** Remove `READY_FOR_PICKUP` from `TERMINAL_STATUSES`. Keep polling until `PICKED_UP` or `CANCELLED`. Reduce poll frequency after READY_FOR_PICKUP (switch to 30s instead of 5s) to reduce server load — the only possible transition after READY is PICKED_UP, which is human-driven and slow.

**Files changed:**
- **Modify:** `src/components/OrderStatusTracker.tsx:12` — `TERMINAL_STATUSES = new Set(["PICKED_UP", "CANCELLED"])`
- **Modify:** `src/components/OrderStatusTracker.tsx:13` — add `SLOW_POLL_INTERVAL_MS = 30000`
- **Modify:** `src/components/OrderStatusTracker.tsx:26-51` — adjust polling logic: poll at 5s until READY_FOR_PICKUP, then switch to 30s (or just keep 5s — server load is trivial for a coffee shop)

**Test plan:**
- Unit: Polling continues after order reaches READY_FOR_PICKUP
- Unit: Polling stops when order reaches PICKED_UP
- Unit: PICKED_UP status reflected in UI without page reload
- Integration: full flow — order placed → advanced to READY → barista marks PICKED_UP → customer sees "Selesai" within poll interval

**Acceptance criteria:**
- [ ] Customer sees live update from READY_FOR_PICKUP to PICKED_UP without reload
- [ ] Polling stops cleanly at PICKED_UP and CANCELLED
- [ ] No regression on existing terminal behavior

---

## DEPENDENCY GRAPH & EXECUTION PHASES

```
Phase 1 (no dependencies, can parallelize)
├── CUST-03: polling fix (1 file, trivial)
└── CUST-01: statusLogs in customer API (2 files)

Phase 2 (depends on Phase 1 for clean merge)
├── CUST-02: re-entry via localStorage + phone lookup (4 files)
└── PICKUP-01 + PICKUP-02: PIN verification + code display (6 files)
   └── Schema migration (prerequisite for PICKUP-01)
```

**Phase 1** is safe — additive changes with zero schema impact. Can ship immediately.
**Phase 2** needs schema migration (new `pickupCode` column) — requires prisma migrate + careful rollback plan.

---

## PIONEER TASK BREAKDOWN

| # | Task | Est. (hrs) | Files | Depends On |
|---|------|------------|-------|------------|
| T16-1 | CUST-03: Fix polling — remove READY_FOR_PICKUP from TERMINAL_STATUSES | 0.5 | OrderStatusTracker.tsx | — |
| T16-2 | CUST-01: Add statusLogs to customer GET + timeline UI | 2.0 | order/[orderId]/route.ts, OrderStatusTracker.tsx, new StatusTimeline.tsx | — |
| T16-3 | Schema: add pickupCode to Order model + migration | 0.5 | schema.prisma, migration | — |
| T16-4 | PICKUP-02: Display order code on OrderCard (quick win) | 0.5 | OrderCard.tsx | T16-3 |
| T16-5 | PICKUP-01: PIN verification gate on admin PATCH | 2.0 | admin/orders/[orderId]/route.ts, order/route.ts, types | T16-3 |
| T16-6 | PICKUP-01: PIN display on customer + barista UI | 1.5 | OrderCard.tsx, OrderStatusTracker.tsx, admin board | T16-3, T16-5 |
| T16-7 | CUST-02: localStorage persistence + menu banner | 1.5 | OrderForm.tsx, menu page.tsx, order page.tsx | — |
| T16-8 | CUST-02: Phone lookup endpoint + rate limit | 1.5 | new order/lookup/route.ts, rate-limit.ts | — |
| T16-9 | Integration tests for all 5 gaps | 2.0 | tests/order-progress.test.ts, tests/pickup-verify.test.ts | T16-1..8 |
| T16-10 | E2E: happy path from order→pickup with PIN | 1.5 | e2e/pickup-flow.spec.ts | T16-1..9 |

**Total: ~12.5 hours** (10 tasks)
**Recommended execution order:** T16-1 → T16-2 → T16-3 → T16-4 → T16-5 → T16-6 → T16-7 → T16-8 → T16-9 → T16-10

T16-1 and T16-2 can run in parallel (Phase 1). T16-7 can start anytime (no schema dependency). T16-9 and T16-10 must wait for all prior tasks.

---

## RISKS & TRADE-OFFS

1. **Phone lookup enumeration risk (CUST-02):** Rate limit mitigates but doesn't eliminate. `customerPhone` is PII — consider requiring `slug` + `phone` to scope queries per tenant. Already built into the approach.
2. **localStorage in private browsing (CUST-02):** localStorage cleared on session end in incognito. Fall back to phone lookup endpoint as secondary recovery path.
3. **4-digit PIN collision (PICKUP-01):** With ~50 active orders per sprint, collision probability is ~0.05%. Acceptable. If needed, scope PIN uniqueness per sprint (tenant+sprint). Not worth the complexity for v1.
4. **Schema migration rollback (PICKUP-01):** New column with default `""` is non-breaking. Migration is additive — safe to roll forward.
5. **Polling load (CUST-03):** Removing READY_FOR_PICKUP from TERMINAL adds ~30-60s of extra polling per order. For typical coffee shop volume (10-20 concurrent), negligible. If concerned, implement adaptive polling (5s → 30s after READY).

---

## OUT OF SCOPE (explicit)

- SMS/WhatsApp notification for order status (needs gateway integration)
- Order history for past/completed orders beyond current session
- Admin "override PIN" for lost-code scenarios (add as follow-up if needed)
- PIN complexity (alphanumeric, 6-digit)
- Delivery/logistics, refund, loyalty, native app — all excluded per issue scope
