-- Monetisation Phase 3 / T20 — Demo tenants → PRO permanen (issue #257)
-- Plan doc: docs/MONETIZATION-PLAN-PHASE3.md §11.
--
-- ⚠️ JALANKAN MANUAL di DB PRODUCTION (mis. via vercel CLI / psql prod).
--    BUKAN migration, BUKAN seed — jangan pernah masuk ke prisma/migrations
--    atau prisma/seed.ts.
--
-- Efek: tenant demo tetap bisa dipakai showcase tanpa feature gate.
-- planExpiresAt = NULL → cron re-bill & auto-downgrade otomatis SKIP
-- (POST /api/cron/rebill hanya memproses tenant dgn planExpiresAt != null).
--
-- Rollback (kalau perlu):
--   UPDATE "Tenant" SET "plan" = 'FREE' WHERE "slug" IN ('kopi-makassar', 'kopi-senja');

UPDATE "Tenant"
SET "plan" = 'PRO', "planExpiresAt" = NULL
WHERE "slug" IN ('kopi-makassar', 'kopi-senja');
