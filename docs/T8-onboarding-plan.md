## Senior Execution Plan — T8: Tenant Onboarding (v2 — corrected against real repo)

### Actual repo state (audited)
- `/Users/ahmadilham/documents/bukan_project/orderin` @ `15f1e90` (branch `feature/t7-testing-bugfix`)
- Next.js 14.2 App Router + Prisma 7 + PostgreSQL + Tailwind CSS
- Auth: stateless HMAC cookie (`src/lib/auth.ts` — `createSession`, `sessionCookie`)
- Password: scrypt via `node:crypto` (`src/lib/password.ts` — `hashPassword`, `verifyPassword`)
- Tenant isolation: `scoped(tenantId)` wrapper + fail-closed Prisma extension (`src/lib/prisma.ts`)
- Public DB client: `@/lib/db` (unscoped, used by landing page)
- Admin API client: `@/lib/admin-api` (fetch wrappers)
- API helpers: `ok()`, `fail()`, `readJson()` (`src/lib/api.ts`)
- Test: vitest, integration tests hitting real Postgres, `tests/` directory
- **No register page, no register API, no slug-check endpoint exist**

### Gap analysis
| Requirement | Status |
|---|---|
| Public register page: shop name, slug, admin credentials | ❌ No page exists |
| Slug auto-suggest + validate unique | ❌ Nothing exists |
| POST /api/register | ❌ No route |
| Slug format validation + uniqueness | ❌ Not implemented |
| GET /api/slug-check | ❌ No route |
| Redirect to /admin/\<slug\>/login | ❌ No register, so no redirect |
| Tests | ❌ None for register flow |

### Execution Plan

#### 1. `src/app/register/page.tsx` — NEW public register page
- "use client" component (matching login page pattern)
- Form fields: shopName, slug (editable), adminUsername, adminPassword
- Auto-suggest slug from shopName onChange (debounced 300ms):
  - lowercase, strip diacritics, replace spaces with dashes, strip special chars
- Slug availability check: debounced GET to `/api/slug-check?slug=xxx`
  - Show green ✓ / red ✗ indicator
- Client-side slug validation: regex `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, length 3–50
- On submit: POST to `/api/register`, redirect to `/admin/${slug}/login` on success
- Error display matching login page pattern (rose-50 bg, rose-700 text)
- Busy state: button disabled + "Mendaftarkan…" text
- Add "Sudah punya kedai? Login di sini" link at bottom
- Style: match login page pattern (centered card, slate-100 bg)

#### 2. `src/app/api/register/route.ts` — NEW API route
```typescript
// POST /api/register
// Body: { name, slug, username, password }
// Validates all fields present + slug format + uniqueness
// Creates Tenant + TenantAdmin in Prisma transaction
// Returns { ok: true, tenant: { slug, name } }
// Sets session cookie via createSession + sessionCookie
```
- Validate: all fields non-empty strings
- Validate slug: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, length 3–50, no leading/trailing/consecutive dashes
- Check slug uniqueness (use `@/lib/db` unscoped client for Tenant lookup)
- Use prisma (scoped extension from `@/lib/prisma`) for transaction:
  ```typescript
  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({ data: { name, slug } });
    await tx.tenantAdmin.create({
      data: { tenantId: t.id, username, passwordHash: hashPassword(password) }
    });
    return t;
  });
  ```
- Catch P2002 (Prisma unique constraint): return 409 with "Slug already taken" or "Username already taken"
- Return `ok({ ok: true, tenant: { slug: tenant.slug, name: tenant.name } })` with Set-Cookie header
- Import from: `@/lib/prisma` (prisma), `@/lib/password` (hashPassword), `@/lib/auth` (createSession, sessionCookie), `@/lib/api` (ok, fail, readJson), `@/lib/db` (for unscoped uniqueness check)

#### 3. `src/app/api/slug-check/route.ts` — NEW API route
```typescript
// GET /api/slug-check?slug=xxx
// Returns { available: boolean }
```
- Validate slug format (same regex)
- Check Tenant.findUnique({ where: { slug } }) using `@/lib/db` (unscoped)
- Return `ok({ available: !tenant })`
- Keep it fast: single DB lookup, no auth required

#### 4. `src/lib/register-api.ts` — NEW client helper (optional, or inline in page)
```typescript
export async function register(data: {
  name: string; slug: string; username: string; password: string;
}): Promise<{ ok: boolean; tenant: { slug: string; name: string } }> {
  // POST /api/register, credentials: "include", throw on error
}
export async function checkSlug(slug: string): Promise<boolean> {
  // GET /api/slug-check?slug=xxx
}
```
Follow pattern from `src/lib/admin-api.ts` (same `req<T>` helper or inline)

#### 5. `tests/register.test.ts` — NEW integration tests
Follow existing vitest pattern (`tests/tenant-isolation.test.ts`):
- **beforeAll**: cleanup old test tenants by timestamp slug
- **afterAll**: delete created test data
- Test cases:
  1. `POST /api/register` creates tenant + admin, returns session cookie
  2. Slug format validation rejects invalid slugs (test: uppercase, special chars, leading dash, too short, too long, consecutive dashes)
  3. Duplicate slug returns 409
  4. Duplicate username (same tenant) returns 409
  5. Registration → login works: POST /api/admin/auth with same credentials succeeds
  6. Tenant isolation: adminA can't access tenantB's data (reuse existing pattern)
  7. Slug-check returns `available: false` after registration
  8. Slug-check validates format (invalid slug returns error)

### Files to create
| File | Action |
|---|---|
| `src/app/register/page.tsx` | CREATE — register form |
| `src/app/api/register/route.ts` | CREATE — POST handler |
| `src/app/api/slug-check/route.ts` | CREATE — GET handler |
| `tests/register.test.ts` | CREATE — integration tests |

### Files to reference (do NOT modify)
| File | Used for |
|---|---|
| `src/lib/prisma.ts` | `prisma` (scoped), `scoped()` — transaction for Tenant+Admin creation |
| `src/lib/db.ts` | `prisma` (unscoped) — slug uniqueness check, slug-check lookup |
| `src/lib/password.ts` | `hashPassword` — hash admin password |
| `src/lib/auth.ts` | `createSession`, `sessionCookie` — issue session cookie on register |
| `src/lib/api.ts` | `ok`, `fail`, `readJson` — API response helpers |
| `src/lib/admin-api.ts` | Pattern for client-side fetch wrappers |
| `src/app/admin/[tenantSlug]/login/page.tsx` | UX pattern (centered card, error display, busy state) |
| `tests/tenant-isolation.test.ts` | Test pattern (vitest + beforeAll/afterAll + real DB) |

### Edge Cases & Pitfalls
- **P2002 race condition**: Two simultaneous registrations with same slug — Prisma unique constraint catches it. Return 409, tell user to retry.
- **Slug auto-suggest**: Only triggers if slug field hasn't been manually edited (use a `userEditedSlug` ref). After manual edit, stop auto-suggesting.
- **Username uniqueness**: `@@unique([tenantId, username])` — username is unique per tenant, not globally. But during registration we only create one admin per tenant, so it's effectively unique per new registration.
- **Transaction isolation**: Create Tenant first (gets UUID), then TenantAdmin with tenantId. If TenantAdmin creation fails, Tenant is rolled back.
- **Session cookie on register**: Auto-login after register is nicer UX, but KISS — just set the cookie + redirect to /admin/\<slug\>. The admin can immediately use the dashboard.
- **No rate limiting on slug-check**: MVP doesn't need it — the API is trivial (single indexed lookup). Can add later.
- **Password minimum length**: Enforce min 6 chars on server side.
- **Backward compat**: No existing register flow → no migration concerns.
