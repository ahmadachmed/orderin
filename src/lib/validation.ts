/**
 * Shared input-validation primitives — issue #252 audit.
 *
 * Route handlers use these to reject malformed input with 400 (or 404 for
 * unknown-id path params) instead of letting bad values reach Prisma (which
 * would surface as a 500) or the DB (unbounded strings).
 */

/** Tenant slug: lowercase letters, digits, single hyphens between segments. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 50 &&
    SLUG_RE.test(value)
  );
}

/** Abuse guards for free-text customer fields (not strict formats). */
export const NAME_MAX = 100;
export const PHONE_MAX = 30;

export function hasLengthAtMost(
  value: unknown,
  max: number
): value is string {
  return typeof value === "string" && value.length <= max;
}
