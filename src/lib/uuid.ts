/**
 * UUID validation for path params — issue #135.
 *
 * Order IDs are UUIDs; passing a non-UUID (e.g. "xxx") into a Prisma
 * findUnique/update used to throw `invalid input syntax for type uuid`
 * → 500. Validate the format BEFORE any DB call so callers get a clean
 * 404 instead (same as an unknown tenant/order).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
