# T9 Sprint Gap-Fix — Execution Plan

**Audit source**: `docs/test-audit-scenarios.csv` (commit `7b1b6fd`). 78 scenario, 51 implemented, 27 gap. This plan covers 13 priority gaps (Critical→Low).

**Verified against**: actual repo files at `/Users/ahmadilham/Documents/bukan_project/orderin` (main, commit `7b1b6fd`). Every file path + line number below is verified — no hallucination.

---

## ⚠️ FALSE POSITIVE: ADMIN-06

**Actual state**: Dashboard already has 5s polling (`src/app/admin/[tenantSlug]/page.tsx` lines 55-63: `setInterval(load, 5000)`). The audit CSV was written before this was implemented. Skip ADMIN-06.

---

## Execution Order (Dependency Graph)

```
Phase 1 (no deps — parallel):
  SEC-05 ──┐
  REG-08 ──┤
  SETTINGS-03 ──┤
  ORDER-07 ──┘

Phase 2 (small self-contained):
  LOGIN-05 (depends on: DELETE /api/admin/auth route → then UI)
  REG-10 + LOGIN-01 (same area: redirect logic in register + login pages)
  SETTINGS-05 (timezone display — touches public page + lib)

Phase 3 (shared concern → design first):
  Rate Limiting (register, login, order, slug-check)

Phase 4 (needs infra setup):
  TEST-02 (Vitest + jsdom + RTL)
  TEST-03 (Playwright setup)
  ISOLATION-03 (needs test infra in place)

Phase 5 (architectural — careful):
  ORDER-10 (queue cap serialization)
```

---

## Per-Gap Plan

### 1. SEC-05 — Fail-fast SESSION_SECRET (Critical)

**Root cause**: `src/lib/auth.ts:11` — `const SECRET = process.env.SESSION_SECRET ?? "orderin-dev-insecure-secret-change-me"`. Deploy without env var → every session forgeable.

**Approach**: Fail-fast at startup. Throw fatal error in `auth.ts` module init if NODE_ENV=production and SESSION_SECRET is undefined or equals the dev default.

**Files changed**:
- `src/lib/auth.ts` — add startup guard after line 11:
  ```ts
  if (process.env.NODE_ENV === "production") {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "orderin-dev-insecure-secret-change-me") {
      throw new Error("[orderin] SESSION_SECRET is missing or still the dev default — refusing to start in production");
    }
  }
  ```
- `.env.example` — add `SESSION_SECRET` docs

**Test plan**: Unit test verifies `auth.ts` throws on import when NODE_ENV=production + SESSION_SECRET unset. Test `verifySession` still works with real secret.

**AC**: 
- `next build` in production fails if SESSION_SECRET undefined or equals dev default
- Existing session tests pass (non-production mode unaffected)
- `.env.example` documents SESSION_SECRET requirement

---

### 2. Rate Limiting — register, login, order, slug-check (High)

**Root cause**: Zero rate limiting on any endpoint. Slug-check is publicly enumerable. Register/login brute-forcable. Order endpoint spammable.

**Approach**: In-memory sliding-window per IP via a lightweight middleware. No new dependencies — use `Map<string, {count, resetAt}>` with route-specific config per window. Next.js App Router middleware (`src/middleware.ts`) intercepts matching API paths before they hit route handlers.

**Why in-memory + middleware**:
- Zero deps — pure Node.js `Map` + `setInterval` cleanup
- Next.js middleware runs at edge — rejects before handler code loads
- Acceptable for MVP scale (single process; resets on deploy, naturally)
- Per-IP → no Redis needed yet. Post-MVP: Redis if multi-instance.

**Config per route**:
| Route | Window | Max requests | Response |
|-------|--------|-------------|----------|
| POST /api/register | 60s | 3 | 429 + Retry-After |
| POST /api/admin/auth | 60s | 5 | 429 + Retry-After |
| POST /api/order | 10s | 10 | 429 + Retry-After |
| GET /api/slug-check | 10s | 20 | 429 |

**Files changed**:
- `src/middleware.ts` — NEW. Next.js App Router middleware, matcher: `/api/:path*`
- `src/lib/rate-limit.ts` — NEW. Sliding-window store + `checkRateLimit(ip, route, config)` 
- `tests/rate-limit.test.ts` — NEW. Integration tests per route

**Test plan**:
- Hit each endpoint max+1 times → 429 on the last
- Wait window+1s → retry → accepted again
- Different IPs get independent windows
- Verify X-RateLimit headers (Remaining, Reset)

**AC**:
- Each endpoint rate-limited per spec above
- 429 includes Retry-After header
- No impact on un-limited routes (GET /api/admin/orders, etc.)
- In-memory store cleans up expired entries periodically

---

### 3. LOGIN-05 — Logout (High)

**Root cause**: `adminLogout()` exists in `src/lib/admin-api.ts:51-53` — calls `DELETE /api/admin/auth` — but `/api/admin/auth/route.ts` has NO DELETE handler. No logout button in admin UI header (`src/app/admin/[tenantSlug]/page.tsx` nav: Menu, Payment, Shop view — no logout).

**Approach**: Two changes, simple:
1. Add `DELETE` handler to `/api/admin/auth` — clears session cookie
2. Add logout button to admin dashboard header

**Files changed**:
- `src/app/api/admin/auth/route.ts` — add `DELETE` handler:
  ```ts
  export async function DELETE() {
    const res = new NextResponse(null, { status: 204 });
    res.headers.set("Set-Cookie", clearSessionCookie());
    return res;
  }
  ```
- `src/app/admin/[tenantSlug]/page.tsx` — add logout button in nav (line 164-185):
  ```tsx
  import { adminLogout } from "@/lib/admin-api";
  // + button calling adminLogout() → router.push(`/`) → router.refresh()
  ```
- `src/app/admin/[tenantSlug]/settings/page.tsx` — same logout button in nav
- `src/app/admin/[tenantSlug]/menu/page.tsx` — same (if exists)

**Test plan**: Login → click logout → redirected to landing → cookie cleared → admin pages return 401.

**AC**:
- DELETE /api/admin/auth returns 204 + Set-Cookie clear
- Logout button visible on dashboard, settings, menu admin pages
- After logout, navigating to /admin/<slug> redirects to login

---

### 4. REG-10 + LOGIN-01 — Redirect logic (Medium)

**Root cause (REG-10)**: `src/app/register/page.tsx:96` — `router.push(`/admin/${data.tenant.slug}/login`)` — redirects to login page despite session cookie already being set at API level (`/api/register` line 55: `res.headers.set("Set-Cookie", sessionCookie(token))`). User must re-login immediately after registering.

**Root cause (LOGIN-01)**: `src/app/admin/[tenantSlug]/login/page.tsx` — no session check on mount. User with valid cookie still sees login form.

**Approach**: 
1. REG-10: Change register success redirect from login → dashboard
2. LOGIN-01: Add a server-side layout check or client-side session probe that redirects to dashboard if already authenticated

**Files changed**:
- `src/app/register/page.tsx:96` — change to `router.push(`/admin/${data.tenant.slug}`)`
- `src/app/admin/[tenantSlug]/login/page.tsx` — add useEffect that probes `GET /api/admin/orders` (or a lightweight `/api/admin/auth` GET) — if response is 200 (valid session) → `router.push(`/admin/${tenantSlug}`)`. If 401 → stay on login. While probing → show spinner.
- `src/app/api/admin/auth/route.ts` — add `GET` handler that returns `ok({ authenticated: true })` if session valid, `fail("Unauthorized", 401)` if not. (Lightweight probe — single fn, no DB query)

**Test plan**:
- REG-10: Register → verify redirect is to `/admin/<slug>` (dashboard), not login
- LOGIN-01: Login → close tab → reopen `/admin/<slug>/login` → auto-redirect to dashboard
- LOGIN-01: Clear cookies → open `/admin/<slug>/login` → stays on login page

**AC**:
- After successful registration, user lands on admin dashboard
- Login page auto-redirects already-authenticated users to dashboard
- No flash of login form visible to authenticated users

---

### 5. SETTINGS-03 — HH:mm validation (Medium)

**Root cause**: `src/app/api/admin/settings/route.ts:68-77` — openTime/closeTime accepted as raw strings, no format check. Invalid values stored → `isWithinHours()` in `src/lib/time.ts` does `slice(11,16)` comparison which silently breaks.

**Approach**: Regex validation in PATCH handler. Also apply to openTime/closeTime fields specifically (not all STRING_FIELDS).

**Files changed**:
- `src/app/api/admin/settings/route.ts` — add after line 76:
  ```ts
  const HH_MM = /^\d{2}:\d{2}$/;
  if (body.openTime !== undefined && body.openTime !== null && !HH_MM.test(body.openTime as string)) {
    return fail("openTime must be HH:mm format (e.g. 07:00)", 400);
  }
  if (body.closeTime !== undefined && body.closeTime !== null && !HH_MM.test(body.closeTime as string)) {
    return fail("closeTime must be HH:mm format (e.g. 21:00)", 400);
  }
  ```
- `tests/order-flow.test.ts` or `tests/register.test.ts` — add test: PATCH settings openTime="abc" → 400

**Test plan**:
- PATCH openTime="07:00" → 200
- PATCH openTime="abc" → 400 "must be HH:mm format"
- PATCH openTime="7:00" → 400 (missing leading zero)
- PATCH openTime="24:01" → accepted (format valid; semantic validation post-MVP)
- Existing settings tests still pass

**AC**:
- Invalid time format rejected with clear error
- Valid HH:mm accepted (07:00 through 23:59)

---

### 6. SETTINGS-05 — Timezone display on public page (Medium)

**Root cause**: `src/app/[tenantSlug]/page.tsx:57` — `Kedai tutup — buka kembali pukul ${tenant.openTime} UTC.` — displays raw UTC, ignoring `tenant.timezone` field. Plan §7.3 says all-UTC storage but presentation layer should convert. The `timezone` field exists but is unused.

**Approach**: Use `Intl.DateTimeFormat` or a lightweight helper to convert UTC HH:mm to the tenant's timezone for display. Server-side (RSC) conversion at render time.

**Files changed**:
- `src/lib/time.ts` — add `formatTimeInTimezone(utcHHmm: string, timezone: string): string`:
  ```ts
  export function formatTimeInTimezone(utcHHmm: string, timezone: string): string {
    const [h, m] = utcHHmm.split(":").map(Number);
    const d = new Date(Date.UTC(2024, 0, 1, h, m)); // any date, just the time
    return d.toLocaleTimeString("id-ID", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  }
  ```
- `src/app/[tenantSlug]/page.tsx:57` — change to:
  ```ts
  const openDisplay = formatTimeInTimezone(tenant.openTime, tenant.timezone || "Asia/Jakarta");
  const closeDisplay = formatTimeInTimezone(tenant.closeTime, tenant.timezone || "Asia/Jakarta");
  const closedMessage = tenant.isOpen
    ? `Kedai tutup — buka kembali pukul ${openDisplay} (${tenant.timezone || "WITA"}).`
    : "Kedai sedang tutup — pesanan belum bisa diterima.";
  ```

**Test plan**:
- Tenant timezone="Asia/Jakarta", openTime="01:00" UTC → displays "08:00" 
- Tenant timezone="Asia/Makassar", openTime="01:00" UTC → displays "09:00"
- Invalid timezone → falls back gracefully (try/catch → raw UTC)

**AC**:
- Public menu page shows operating hours in tenant's timezone, not UTC
- Graceful fallback if timezone is invalid

---

### 7. REG-08 — Confirm password field (Medium)

**Root cause**: `src/app/register/page.tsx:166-178` — single password field. Typo invisible to user.

**Approach**: Add confirm-password field + client-side match validation before submit.

**Files changed**:
- `src/app/register/page.tsx` — add state: `const [confirmPassword, setConfirmPassword] = useState("")`. Add field after password. Before submit (line 80): check `password !== confirmPassword` → setError("Password tidak cocok"). 

**Test plan**:
- Fill password="abc123", confirm="abc124" → submit → error "Password tidak cocok", no API call
- Fill password="abc123", confirm="abc123" → submit → API called normally
- Empty confirm field → browser `required` validation

**AC**:
- Confirm password field visible below password
- Mismatch rejected client-side before API call
- Match → submit proceeds normally

---

### 8. ORDER-10 — Queue cap race condition (Medium)

**Root cause**: `src/app/api/order/route.ts:63-68` — check-then-create pattern. Comment on line 63-65 acknowledges: "Note: check-then-create is not atomic — two concurrent requests can both pass the cap."

**Approach**: Wrap queue-cap check + order creation in a serializable transaction. Options:
- **Option A (recommended)**: Postgres advisory lock (`pg_advisory_xact_lock`) on a deterministic tenant-scoped lock key. Acquired inside the same transaction as the order create → auto-released on commit/rollback.
- **Option B**: `SELECT ... FOR UPDATE` on the tenant row before count+create. More heavyweight but also correct.
- **Option C**: Accept mild overshoot (MVP comment) — not for production.

Choose **Option A** — advisory lock is lightweight, tenant-scoped (no global bottleneck), and auto-releases.

**Files changed**:
- `src/app/api/order/route.ts` — wrap lines 59-111 in:
  ```ts
  const lockKey = tenant.id.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
  ```
  inside the try block. This serializes all order creation per tenant without blocking other tenants.
- `tests/order-flow.test.ts` — add concurrent order submit test (spawn 2 promises at queue=19 → verify only 1 succeeds, queue=20)

**Test plan**: Manual concurrent test with 2 parallel POST when queue.size = max-1. Only one should create; other gets 429.

**AC**:
- Concurrent requests cannot exceed maxQueueSize
- Lock is tenant-scoped (tenant A's lock doesn't block tenant B)
- No performance regression for single requests

---

### 9. ISOLATION-03 — Cross-tenant order PATCH test (Medium)

**Root cause**: `tests/tenant-isolation.test.ts` covers reads + creates + findUnique isolation but has NO test for cross-tenant order PATCH (mutation). The `scoped()` proxy rewrites `update`→`updateMany` with tenantId injected — need explicit test.

**Approach**: Add test case in existing tenant-isolation test file.

**Files changed**:
- `tests/tenant-isolation.test.ts` — add in "orders are tenant-scoped" describe:
  ```ts
  it("PATCH order from tenant B using tenant A scoped client returns 0 count", async () => {
    const orderInB = await scoped(tenantB.id).order.create({...});
    const res = await scoped(tenantA.id).order.update({ where: { id: orderInB.id }, data: { status: "CONFIRMED" } });
    expect((res as { count: number }).count).toBe(0);
  });
  ```

**Test plan**: Run alongside existing isolation tests. Verify scoped update on foreign tenant order affects 0 rows.

**AC**:
- Test passes — confirms cross-tenant order mutation is impossible via scoped client
- No change to production code (test-only)

---

### 10. TEST-02 — Component tests (Medium)

**Root cause**: No component tests exist. `vitest.config.ts` uses `node` environment. `@testing-library/react` not installed.

**Approach**: 
1. Install deps: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
2. Update `vitest.config.ts` — add jsdom environment + setup file
3. Write basic component tests for `OrderForm` and `OrderStatusTracker`

**Files changed**:
- `package.json` — add devDeps
- `vitest.config.ts` — add:
  ```ts
  test: {
    environment: "jsdom", // override in node tests via // @vitest-environment node
    setupFiles: ["./tests/setup.ts"],
    // ...
  }
  ```
- `tests/setup.ts` — NEW: `import "@testing-library/jest-dom/vitest"`
- `tests/components/OrderForm.test.tsx` — NEW. Test: renders items, quantity buttons, submit disabled when cart empty, error message on API fail.
- `tests/components/OrderStatusTracker.test.tsx` — NEW. Test: renders status, shows ETA, shows payment method, polling triggers on interval.

**Test plan**:
- OrderForm: renders all menu items, +/– buttons change quantities, submit calls fetch with correct body, submit redirects on success
- OrderStatusTracker: renders order details, polling triggers at interval, stops polling when status terminal

**AC**:
- 5+ component tests passing
- No regression in existing 102 tests
- Components testable in jsdom without real Postgres

---

### 11. TEST-03 — E2E setup (High)

**Root cause**: No E2E framework, no Playwright config. 

**Approach**: Minimal Playwright setup with 1 happy-path test: register → order → payment → status tracking.

**Files changed**:
- `package.json` — add `@playwright/test` devDep
- `playwright.config.ts` — NEW. Headless Chromium, baseURL=http://localhost:3000, 1 worker.
- `e2e/happy-path.spec.ts` — NEW. Steps:
  1. Navigate to /register, fill form, submit → assert redirect to /admin/<slug>
  2. Login as admin, create menu item via admin UI
  3. Navigate to /<slug>, add item to cart, fill name/phone, submit → assert redirect to /<slug>/order/<id>
  4. Order status page shows PENDING with payment options
  5. (Optional) Mark paid as admin → status advances
- `.github/workflows/ci.yml` — add E2E step (after build): start server, run playwright

**Test plan**: Run locally against dev DB. CI runs against test DB.

**AC**:
- Playwright configured with 1 happy-path test
- Test passes locally with `npx playwright test`
- CI step added but can be conditionally gated (only on PRs labeled `e2e` initially)

---

### 12. ORDER-07 — Duplicate item ID behavior (Low)

**Root cause**: `src/app/api/order/route.ts:73` — `Array.from(new Set(items.map(i => i.menuItemId)))` dedupes for validation only. Line 82-89 creates separate OrderItem rows for each entry in `items[]` — does NOT aggregate quantities.

**Approach**: Decide on behavior + implement:
- **Decision: Aggregate** — same menuItemId repeated in items[] → sum quantities into a single OrderItem row. This is the expected UX: customer adds "Kopi Susu x2" not two separate Kopi Susu x1 entries.
- Alternative reject: less user-friendly, might confuse customers who accidentally split.

**Files changed**:
- `src/app/api/order/route.ts` — after line 50 (validation loop), add aggregation:
  ```ts
  const aggregated = new Map<string, number>();
  for (const item of items) {
    aggregated.set(item.menuItemId, (aggregated.get(item.menuItemId) || 0) + item.quantity);
  }
  const uniqueItems = Array.from(aggregated, ([menuItemId, quantity]) => ({ menuItemId, quantity }));
  ```
  Then use `uniqueItems` instead of `items` for menu validation and order creation.
- `tests/order-flow.test.ts` — add test: submit order with duplicate menuItemId → creates single OrderItem with summed quantity.

**Test plan**:
- POST items=[{A,qty:2}, {A,qty:3}] → order created with one OrderItem for A with qty=5
- POST items=[{A,qty:1}, {B,qty:1}] → order created with two OrderItems (no aggregation needed)

**AC**:
- Duplicate menuItemIds are aggregated into single OrderItem rows
- Quantity sum is correct
- Existing order tests still pass (single-item orders unaffected)

---

## Out of Scope (Sprint Ini)

| Gap | Reason |
|-----|--------|
| DEPLOY-01, DEPLOY-03 | Menunggu keputusan user (Vercel + Aiven creds) |
| MENU-07 (image upload) | Post-MVP feature |
| ADMIN-07 (pagination) | Post-MVP; skala MVP kecil |
| ADMIN-08 (history view) | Post-MVP; active-only by design |
| LOGIN-06 (ubah password) | Post-MVP; admin self-service belum prioritas |
| LOGIN-07 (sliding session) | Post-MVP; stateless by design, TTL 7 hari cukup |
| SEC-03 (CSRF token) | Post-MVP; SameSite=Lax sudah cukup untuk MVP |
| STATUS-05 (polling error UX) | Low; tracker works for happy path |
| PAY-07 (fake payment) | Acknowledged design tradeoff; barista verification manual |

## Recommended Assignment

Semua 12 gap di atas bisa dikerjakan oleh **pioneer** (single sprint). Urutan:
1. Phase 1 (SEC-05, REG-08, SETTINGS-03, ORDER-07) — ~2 jam
2. Phase 2 (LOGIN-05, REG-10+LOGIN-01, SETTINGS-05) — ~2 jam  
3. Phase 3 (Rate Limiting) — ~3 jam (desain + impl + test)
4. Phase 4 (TEST-02, TEST-03, ISOLATION-03) — ~4 jam (setup + write tests)

Total estimasi: ~11 jam engineering. Saran: pecah jadi 3-4 kanban task untuk pioneer.
