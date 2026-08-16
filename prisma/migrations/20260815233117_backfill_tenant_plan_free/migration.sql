-- T2: Backfill — ensure all existing tenants have plan=FREE, isActive=true.
-- Idempotent: safe to run on prod & dev. Only updates rows that deviate.
-- T1 migration (20260815160614) already added columns with NOT NULL DEFAULT,
-- so PostgreSQL auto-filled existing rows. This migration makes it explicit
-- and catches any edge case where a row might have an unexpected value.

-- Backfill plan: set to FREE for any tenant not already on FREE or PRO.
UPDATE "Tenant"
SET "plan" = 'FREE'
WHERE "plan" IS NULL OR "plan" NOT IN ('FREE', 'PRO');

-- Backfill isActive: set to true for any tenant where it's NULL or false.
-- Note: isActive defaults to true (T1), but we set explicitly to be safe.
UPDATE "Tenant"
SET "isActive" = true
WHERE "isActive" IS NULL OR "isActive" = false;

-- Clear planExpiresAt for FREE tenants (no expiry on FREE plan).
UPDATE "Tenant"
SET "planExpiresAt" = NULL
WHERE "plan" = 'FREE' AND "planExpiresAt" IS NOT NULL;
