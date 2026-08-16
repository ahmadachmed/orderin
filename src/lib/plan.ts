/**
 * Monetisation Phase 1 / T6 — plan feature map (issue #229).
 *
 * Single source of truth for per-plan limits and feature flags.
 * Pure functions only — no DB access, no side effects. This makes the
 * module trivially testable and safe to call from API routes, server
 * components, and worker code alike.
 *
 * Downstream enforcement tasks (T7–T12) import from here rather than
 * re-declaring constants, so a plan change is a one-line edit.
 */
import { Plan } from "@/generated/prisma/enums";

// Re-export so callers can import { Plan } from "@/lib/plan" if desired.
export { Plan };

// ─────────────────────────────────────────────────────────────────────
// Feature flags & limits per plan
// ─────────────────────────────────────────────────────────────────────

/**
 * `Infinity` sentinel for "unlimited". We use Number.POSITIVE_INFINITY
 * instead of a magic number so callers can safely do arithmetic
 * comparisons (e.g. `getLimit(plan, "maxQueueSize") > current`) without
 * worrying about an off-by-one against some arbitrary large constant.
 */
export const UNLIMITED = Number.POSITIVE_INFINITY;

/**
 * Feature keys — the set of things that can be gated or limited per plan.
 *
 * - **menuCap**: maximum number of menu items a tenant can have (T7, FREE: 25).
 * - **orderPerMonth**: monthly order quota (T8, FREE: 300).
 * - **maxQueueSize**: ceiling for concurrent queued orders (T9, FREE: 20 / PRO: 100).
 * - **sprintRetentionDays**: how long sprint history is retained (T11, FREE: 1 / PRO: 30).
 * - **showBadge**: whether the "Powered by HeadwayBrew" badge shows on shopfront (T10).
 * - **upsellBanner**: whether the dismissible upsell banner shows in admin (T12).
 */
export type Feature =
  | "menuCap"
  | "orderPerMonth"
  | "maxQueueSize"
  | "sprintRetentionDays"
  | "showBadge"
  | "upsellBanner";

/** Boolean feature flags. */
export type BooleanFeature = "showBadge" | "upsellBanner";

/** Numeric limit features. */
export type LimitFeature = "menuCap" | "orderPerMonth" | "maxQueueSize" | "sprintRetentionDays";

/**
 * Full feature configuration for a single plan.
 *
 * Numeric limits use `Infinity` for "unlimited"; callers should use
 * `getLimit()` (which coerces `Infinity` → `null` for ergonomic
 * "no limit" checks) or compare directly with `Number.isFinite()`.
 */
export interface PlanFeatures {
  /** Max menu items (T7). Infinity = unlimited. */
  menuCap: number;
  /** Max orders per calendar month (T8). Infinity = unlimited. */
  orderPerMonth: number;
  /** Ceiling for concurrent queued orders (T9). */
  maxQueueSize: number;
  /** Sprint retention period in days (T11). */
  sprintRetentionDays: number;
  /** Show "Powered by HeadwayBrew" badge on FREE shopfront (T10). */
  showBadge: boolean;
  /** Show dismissible upsell banner in admin dashboard (T12). */
  upsellBanner: boolean;
}

/**
 * The canonical plan → features map. **Edit this object to change any
 * plan's limits or flags** — every enforcement point reads from here.
 *
 * Values per issue #229:
 * - FREE: menuCap 25, orderPerMonth 300, maxQueueSize 20,
 *   sprintRetentionDays 1, showBadge true, upsellBanner true.
 * - PRO: all numeric limits unlimited (Infinity), maxQueueSize 100,
 *   sprintRetentionDays 30, showBadge false, upsellBanner false.
 */
export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  [Plan.FREE]: {
    menuCap: 25,
    orderPerMonth: 300,
    maxQueueSize: 20,
    sprintRetentionDays: 1,
    showBadge: true,
    upsellBanner: true,
  },
  [Plan.PRO]: {
    menuCap: UNLIMITED,
    orderPerMonth: UNLIMITED,
    maxQueueSize: 100,
    sprintRetentionDays: 30,
    showBadge: false,
    upsellBanner: false,
  },
};

// ─────────────────────────────────────────────────────────────────────
// Pure functions
// ─────────────────────────────────────────────────────────────────────

/**
 * Check whether a boolean feature flag is enabled for the given plan.
 *
 * Use for on/off gates like `showBadge` (T10) or `upsellBanner` (T12).
 *
 * @example
 * if (can(tenant.plan, "showBadge")) { render <PoweredByBadge /> }
 */
export function can(plan: Plan, feature: BooleanFeature): boolean {
  return PLAN_FEATURES[plan][feature];
}

/**
 * Get a numeric limit for the given plan.
 *
 * Returns `Infinity` for unlimited plans; callers can use
 * `Number.isFinite(getLimit(...))` or compare directly.
 * If you prefer `null` for "no limit", use `getLimitOrNull()`.
 *
 * @example
 * const cap = getLimit(tenant.plan, "menuCap");
 * if (Number.isFinite(cap) && currentCount >= cap) return error(402);
 */
export function getLimit(plan: Plan, limit: LimitFeature): number {
  return PLAN_FEATURES[plan][limit];
}

/**
 * Same as `getLimit()` but returns `null` for unlimited (Infinity),
 * which is more ergonomic in "is there a limit?" checks.
 *
 * @example
 * const cap = getLimitOrNull(tenant.plan, "menuCap");
 * if (cap !== null && currentCount >= cap) return error(402);
 */
export function getLimitOrNull(plan: Plan, limit: LimitFeature): number | null {
  const val = PLAN_FEATURES[plan][limit];
  return Number.isFinite(val) ? val : null;
}

// ─────────────────────────────────────────────────────────────────────
// effectiveMaxQueueSize — per-tenant queue cap resolution (T9)
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimal tenant shape — only the fields this function needs.
 * Avoids coupling to the full Prisma Tenant type so the function
 * stays pure and testable without a DB.
 */
export interface PlanTenant {
  plan: Plan;
  maxQueueSize: number;
}

/**
 * Resolve the effective queue cap for a tenant (T9 / issue #229).
 *
 * The per-tenant `maxQueueSize` column already exists in the schema
 * (PLAN §7.2) and defaults to 20. The plan introduces a **ceiling**:
 * the tenant's own `maxQueueSize` is honoured, but it can never exceed
 * the plan's ceiling (FREE: 20, PRO: 100). This lets a PRO tenant
 * raise their own cap up to 100, while a FREE tenant is hard-capped
 * at 20 even if the column says 50.
 *
 * Formula: `min(tenant.maxQueueSize, planCeiling)`
 *
 * @example
 * // FREE tenant with maxQueueSize = 50 in DB → capped to 20
 * const cap = effectiveMaxQueueSize({ plan: "FREE", maxQueueSize: 50 });
 * // → 20
 *
 * // PRO tenant with maxQueueSize = 50 → 50 (under the 100 ceiling)
 * const cap = effectiveMaxQueueSize({ plan: "PRO", maxQueueSize: 50 });
 * // → 50
 */
export function effectiveMaxQueueSize(tenant: PlanTenant): number {
  const ceiling = PLAN_FEATURES[tenant.plan].maxQueueSize;
  return Math.min(tenant.maxQueueSize, ceiling);
}
