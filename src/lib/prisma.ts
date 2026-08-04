/**
 * Prisma client with mandatory tenant-scoping (PLAN §2.2).
 *
 * Shared schema + row-level isolation. Two cooperating layers:
 *
 * 1. `scoped(tenantId)` — returns a tenant-bound client wrapper used by all
 *    route handlers. The wrapper injects `tenantId` directly into every call's
 *    `where` / `data` BEFORE the query is dispatched (pre-validation for
 *    checked create inputs), and rewrites operations that cannot carry an
 *    extra non-unique filter in their `where`:
 *      findUnique[OrThrow] → findFirst[OrThrow]
 *      update / delete     → updateMany / deleteMany (returns {count})
 *    Injection at the wrapper (not the extension hook) is required because
 *    Prisma 7 dispatches query-extension hooks lazily at await time — a
 *    module-global "current tenant" set around the call is already restored
 *    when the hook fires (verified empirically), and input validation runs
 *    before query hooks, so hook-side data injection arrives too late for
 *    checked create inputs.
 *
 * 2. The `$extends` query hook — the fail-closed backstop: any query on a
 *    tenant-scoped model (MenuItem, Order, TenantAdmin) that reaches the
 *    client WITHOUT a tenantId (context or args) is refused. This catches
 *    code that bypasses `scoped()`. Exception: findUnique/findUniqueOrThrow
 *    by UUID pass through (the public order status lookup — a globally-unique
 *    id cannot leak a list). Models without a `tenantId` column (OrderItem,
 *    OrderStatusLog) and the Tenant model itself are never scoped (Tenant ops
 *    are guarded by the session-derived id, never by request body).
 *
 * No raw queries anywhere in route code — the extension is mandatory.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/** Models with a `tenantId` column — must always be tenant-filtered. */
const TENANT_SCOPED = new Set(["MenuItem", "Order", "TenantAdmin", "Sprint"]);
/** Model delegate names on the client for these models. */
const SCOPED_DELEGATES = new Set(["menuItem", "order", "tenantAdmin", "sprint"]);
/** Ops that carry a `where` (can be tenant-filtered in place). */
const WHERE_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "aggregate",
  "groupBy",
]);
/** Ops whose `where` cannot take an extra non-unique filter → rewrite. */
const REWRITE_OPS: Record<string, string> = {
  findUnique: "findFirst",
  findUniqueOrThrow: "findFirstOrThrow",
  update: "updateMany",
  delete: "deleteMany",
};
/** Ops refused outright when no tenantId is present (fail-closed). */
const FAIL_CLOSED_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "create",
  "createMany",
  "aggregate",
  "groupBy",
  "upsert",
]);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const base = new PrismaClient({ adapter });

export const prisma = base.$extends({
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!TENANT_SCOPED.has(model)) return query(args);

        const a = args as { where?: Record<string, unknown>; data?: unknown };
        const tenantId =
          (a.where && (a.where.tenantId as string | undefined)) ??
          (a.data && typeof a.data === "object" && !Array.isArray(a.data)
            ? ((a.data as Record<string, unknown>).tenantId as string | undefined)
            : undefined);

        if (!tenantId) {
          if (FAIL_CLOSED_OPS.has(operation)) {
            throw new Error(
              `[orderin] ${model}.${operation} on tenant-scoped model without tenantId — refused (PLAN §2.2). Use scoped(tenantId) or pass tenantId explicitly.`
            );
          }
          // findUnique / findUniqueOrThrow by unguessable UUID (public status page).
          return query(args);
        }

        return query(args);
      },
    },
  },
});

/**
 * Tenant-bound client wrapper. Injects `tenantId` into `where` / `data` and
 * rewrites operations that cannot carry an extra non-unique filter. Every
 * query executed through this wrapper is guaranteed tenant-scoped.
 */
export function scoped<T = typeof prisma>(tenantId: string): T {
  const wrapDelegate = (delegate: object): object =>
    new Proxy(delegate, {
      get(target, prop) {
        const value = (target as Record<string | symbol, unknown>)[prop];
        if (typeof value !== "function") return value;

        const operation = String(prop);
        return (args?: Record<string, unknown>) => {
          let callArgs: Record<string, unknown> = args ?? {};

          // Pre-validation data injection (checked create inputs need tenantId).
          if (
            (operation === "create" ||
              operation === "createMany" ||
              operation === "upsert") &&
            callArgs.data !== undefined
          ) {
            const data = callArgs.data;
            if (!Array.isArray(data) && typeof data === "object") {
              const row = data as Record<string, unknown>;
              if (row.tenantId === undefined) row.tenantId = tenantId;
            } else if (Array.isArray(data)) {
              callArgs = {
                ...callArgs,
                data: data.map((r) =>
                  r && typeof r === "object" &&
                  (r as Record<string, unknown>).tenantId === undefined
                    ? { ...(r as Record<string, unknown>), tenantId }
                    : r
                ),
              };
            }
          }

          const rewritten = REWRITE_OPS[operation];
          if (rewritten) {
            // Rewritten ops get tenantId forced into a cloned where.
            const where = {
              ...((callArgs.where as Record<string, unknown> | undefined) ?? {}),
              tenantId,
            };
            callArgs = { ...callArgs, where };
            const fn = (target as Record<string | symbol, unknown>)[
              rewritten
            ] as (a: Record<string, unknown>) => unknown;
            return fn(callArgs);
          }

          if (WHERE_OPS.has(operation) && callArgs.where !== undefined) {
            const where = callArgs.where as Record<string, unknown>;
            if (where.tenantId === undefined) {
              callArgs = { ...callArgs, where: { ...where, tenantId } };
            }
          } else if (
            WHERE_OPS.has(operation) &&
            callArgs.where === undefined &&
            callArgs.data === undefined
          ) {
            // findMany({}) / count() style calls: seed the where.
            callArgs = { ...callArgs, where: { tenantId } };
          }

          return value(callArgs);
        };
      },
    });

  const client = prisma as unknown as Record<string | symbol, unknown>;
  return new Proxy(client, {
    get(target, prop) {
      const value = target[prop];
      if (SCOPED_DELEGATES.has(String(prop)) && value && typeof value === "object") {
        return wrapDelegate(value);
      }
      return value;
    },
  }) as T;
}

export type { PrismaClient };
