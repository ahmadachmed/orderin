# orderin

A multitenant coffee takeaway ordering SaaS for Makassar. Customers order online, pay at the shop, and pick up — no delivery, no queueing at the counter.

## Overview

Each coffee shop (tenant) gets its own public landing page with a menu, an order flow, and a live order-status page. Baristas manage orders through a per-tenant admin dashboard. The platform is built around a pickup model: customers order ahead, track their position in the queue with a live ETA, pay on arrival (QRIS / bank transfer / cash), and pick up using a 4-digit PIN code.

## Features

- **Multitenant by design** — shared database schema with row-level tenant isolation (scoped Prisma client)
- **Public shop pages** — landing search (keyword → click), menu with categories, mobile-first order form
- **Order status tracking** — live queue position ("Antrean ke-N") + ETA with 5s polling, status timeline, pickup PIN code
- **Customer accounts (optional)** — phone + password login, persistent order history; guests can re-enter via phone lookup
- **Admin dashboard** — desktop-first: order board (PENDING → CONFIRMED → BREWING → READY_FOR_PICKUP), menu & category management, sprint-based order retention, payment config (QRIS image/code, bank account)
- **Payments** — tenant-owned static QRIS, manual bank transfer, or cash; barista confirms PAID before brewing
- **Sprint retention** — orders older than a configurable window are closed out with carry-over of unfinished orders and ETA recalculation

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router), React 18, TypeScript 5 |
| Styling | Tailwind CSS 3, shadcn/ui (Radix primitives + lucide-react) |
| Database | PostgreSQL, Prisma 7 (generated client in `src/generated/prisma`) |
| Auth | HMAC-signed cookies (`SESSION_SECRET`) — admin via TenantAdmin, customer via phone+password. No NextAuth. |
| Tests | Vitest (unit/component), Playwright (E2E) |

## Getting started

Requirements: Node.js 20+, PostgreSQL (or Docker), `.env` with `DATABASE_URL` and `SESSION_SECRET`.

```bash
npm install
npx prisma migrate deploy        # apply migrations
npm run db:seed                  # seed demo tenant + admin
npm run dev                      # http://localhost:3000
```

Environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret used to sign admin/customer session cookies |

> Note: `npm run dev` reads `.env.local` (if present) in addition to `.env`; Prisma CLI commands read only `.env`. Point Prisma at the correct database explicitly when using a local dev DB.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run test` | Run Vitest suite |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Create/apply dev migrations |
| `npm run db:seed` | Seed demo data (`tsx prisma/seed.ts`) |

## Data model

- **Tenant** — coffee shop: slug, name, address, opening hours (with `timezone`), queue size cap, prep buffer, sprint retention days, payment config (QRIS / bank)
- **TenantAdmin** — barista accounts (username + scrypt password hash), per tenant
- **MenuItem** — menu items with category, price, prep time, availability
- **Order** — customer name/phone, status, ETA, payment status/method, optional `customerId` binding, `pickupCode` PIN
- **OrderItem** — line items snapshot (unit price at order time)
- **OrderStatusLog** — full status/payment event timeline with actor info
- **Sprint** — retention window; open/closed lifecycle with carry-over
- **Customer** — optional accounts (phone + password), scoped per tenant

Order lifecycle: `PENDING → CONFIRMED → BREWING → READY_FOR_PICKUP → PICKED_UP`, cancellable at any point. Queue statuses are `PENDING`, `CONFIRMED`, `BREWING`.

## Project structure

```
src/
├── app/
│   ├── page.tsx                    # landing (tenant search + grid)
│   ├── [tenantSlug]/               # public shop, order status, login/register, account
│   ├── admin/[tenantSlug]/         # admin dashboard (orders, menu, settings, sprints)
│   └── api/                        # admin, customer, order, tenant, slug-check, register
├── components/                     # UI components (order form, status tracker, timeline…)
├── lib/                            # auth, queue/ETA, sprint, rate-limit, time, prisma (scoped client)
├── generated/prisma/               # generated Prisma client
└── types/                          # shared types (OrderStatusView, etc.)
prisma/
├── schema.prisma
├── migrations/
└── seed.ts
docs/                               # planning + design docs (PLAN.md, audit scenarios)
tests/                              # Vitest unit/component tests
e2e/                                # Playwright end-to-end tests
```

## Testing

```bash
npm run test                 # unit + component tests (Vitest)
npx playwright test          # E2E suite (see e2e/ + playwright.config.ts)
```

## Deployment

- Frontend: Vercel (Next.js build). Apply DB migrations against the direct Postgres port — the serverless pooler is transaction-pooling and hangs on `prisma migrate deploy`.
- Database: PostgreSQL (e.g. Aiven, Supabase). Pooler URL for the app, direct URL for migrations.

## Documentation

- `docs/PLAN.md` — product plan (data model, flows, decisions)
- `docs/T*-plan.md` — feature execution plans (onboarding, sprint retention, hybrid customer account, gap fixes)
- `docs/test-audit-scenarios.csv` — app-flow audit scenarios (implemented vs gap)

## License

Private project. All rights reserved.
