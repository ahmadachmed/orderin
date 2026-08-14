# CLAUDE.md — HeadwayBrew

## Project Overview

Kopi-makassar ordering app: customer shopfront (mobile-first) + barista/admin dashboard (desktop-first). Multi-tenant (kedai = tenant via slug).

- Stack: Next.js 15 (App Router) + TypeScript + Prisma 7 + PostgreSQL (SumoPod PG16)
- UI: shadcn/ui (Tailwind + Radix + lucide-react)
- Tests: Vitest (`npm test`, jsdom, `tests/**/*.test.ts(x)`), Playwright E2E (`e2e/`, `PLAYWRIGHT_BASE_URL` overridable)
- Deploy: Vercel (pj prj_wcc9oaLmTrWm5p6QlOXzCUj9ONiP) — buildCommand guards migrate via MIGRATE_DATABASE_URL
- DB migrate: connection lives in `.env` (`DATABASE_URL` / `MIGRATE_DATABASE_URL`) — never hardcode credentials. Note: a pooler-suffixed URL FAILS on the direct port, and migrating via the pooler HANGS — keep the migrate URL on the direct port (see `.env` comments)

## Critical Rules

### 1. Code Organization

- Many small files over few large files
- High cohesion, low coupling
- 200-400 lines typical, 800 max per file
- Organize by feature/domain, not by type

### 2. Code Style

- No emojis in code, comments, or documentation
- Immutability always — never mutate objects or arrays
- No console.log in production code
- Proper error handling with try/catch
- Input validation (Zod) at every API boundary

### 3. Testing

- TDD: write tests first (RED → GREEN → REFACTOR)
- 80% minimum coverage (lines, functions, branches, statements)
- Unit tests for utilities; integration for API routes (`// @vitest-environment node` per-file for DB/Node-only tests)
- E2E for critical flows (`e2e/` Playwright) — queue info = posisi + ETA di status page
- Run: `npm test` (vitest) / `npx playwright test` (E2E)

### 4. Security

- No hardcoded secrets — environment variables only (`.env`, `.env.local`)
- Validate all user inputs (Zod)
- Parameterized queries only (Prisma — never raw SQL with interpolation)
- Session auth via SESSION_SECRET; no NextAuth
- No secrets in git history; `.env*` in .gitignore

## File Structure

```
src/
|-- app/              # Next.js app router — customer pages MOBILE-FIRST, admin/barista DESKTOP-FIRST
|-- components/       # shadcn/ui components
|-- hooks/            # Custom React hooks
|-- lib/              # prisma, auth, api helpers
|-- types/
prisma/               # Schema + migrations (never commit without migration)
tests/                # Vitest
e2e/                  # Playwright specs
docs/                 # Plans (docs/PLAN.md = source of truth per sprint)
```

## Key Patterns

### API Response Format

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: { total: number; page: number; limit: number }
}
```

### Route Handler Pattern

```typescript
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ success: false, error: "..." }, { status: 400 })
  }
}
```

## Conventions

- Customer pages: MOBILE-FIRST; barista/admin: DESKTOP-FIRST
- Landing = customer-ONLY (owner login via /login terpisah, bukan link di landing)
- Queue info (posisi + ETA) hanya di status page
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- SOURCE OF TRUTH: `docs/PLAN.md` section tugas — baca sebelum implementasi, jangan improvise
- Kanban task body / PR body: `Closes #N` — list each number explicitly (no range `#32-38`)
