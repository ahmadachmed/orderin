/**
 * Sprint lifecycle logic — T15 (issue #29, PLAN §3).
 *
 * A sprint is a board-retention period per tenant. Exactly one OPEN sprint
 * may exist at a time (enforced at the app layer — PLAN §1.2, no composite
 * unique; the scoped() client injects tenantId on every call, so all queries
 * here are tenant-isolated by construction).
 *
 *   getActiveSprint(tenantId)  → the tenant's OPEN sprint, if any
 *   closeSprint(...)           → close the sprint, carry active orders into a
 *                                fresh sprint, recalc queue ETAs, count the
 *                                orders that stayed behind (archived)
 *
 * Close is manual-only in v1 (PLAN §3.4 — auto-close cron is out of scope).
 *
 * DB access always goes through a tenant-scoped client (scoped(tenantId)) —
 * this module never touches an unscoped client itself.
 */
import { prisma, scoped } from "@/lib/prisma";
import { HttpError } from "@/lib/api";
import { recalculateQueueEtas } from "@/lib/queue";
import { OrderStatus, SprintStatus } from "@/generated/prisma/enums";
import type { Sprint } from "@/generated/prisma/client";

/** Orders still being worked → move to the new sprint on close (PLAN §3.3). */
export const CARRY_OVER_STATUSES = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.BREWING,
  OrderStatus.READY_FOR_PICKUP,
] as const;

/** Finished orders → stay in the closed sprint (archived, PLAN §3.3). */
export const ARCHIVED_STATUSES = [OrderStatus.PICKED_UP, OrderStatus.CANCELLED] as const;

/**
 * The tenant's currently OPEN sprint, or null when none exists.
 *
 * Scoped to the tenant via scoped(tenantId) — the OPEN filter is the only
 * status condition needed (one-open-sprint is an app-layer invariant).
 */
export async function getActiveSprint(tenantId: string): Promise<Sprint | null> {
  const db = scoped(tenantId);
  return db.sprint.findFirst({ where: { status: SprintStatus.OPEN } });
}

export interface CloseSprintResult {
  newSprintId: string;
  /** Orders moved from the closed sprint into the new one. */
  carriedOver: number;
  /** Orders (picked_up / cancelled) that stayed with the closed sprint. */
  archived: number;
}

/**
 * Close a sprint and open a fresh one for the same tenant.
 *
 * Flow (PLAN §2.3 POST /api/admin/sprints/[sprintId]/close + §3.3):
 *   1. Validate the sprint exists, belongs to the tenant (via scoped) and is
 *      still OPEN — 404 when unknown, 409 when already CLOSED (PLAN §7.6,
 *      concurrent "close shift" clicks).
 *   2. Create the new OPEN sprint (startAt = now).
 *   3. Close the old sprint (status=CLOSED, endAt/closedAt = now) with an
 *      optimistic status guard — if a concurrent request closed it first,
 *      the update touches 0 rows → roll the fresh sprint back and throw 409.
 *   4. Carry active orders (PENDING/CONFIRMED/BREWING/READY_FOR_PICKUP) into
 *      the new sprint; PICKED_UP/CANCELLED stay archived in the old one.
 *   5. Recalculate queue ETAs — carried orders land at the back of the new
 *      sprint's FIFO queue (their createdAt is older than fresh orders; this
 *      is by design, PLAN §7.5), so remaining ETAs must be recomputed.
 *
 * Throws HttpError(404) / HttpError(409) — route handlers map these to
 * fail(message, status) responses.
 */
export async function closeSprint(
  tenantId: string,
  sprintId: string,
  prepTimeBuffer: number
): Promise<CloseSprintResult> {
  const db = scoped(tenantId);

  const sprint = await db.sprint.findFirst({ where: { id: sprintId } });
  if (!sprint) throw new HttpError(404, "Sprint not found");
  if (sprint.status !== SprintStatus.OPEN) {
    throw new HttpError(409, `Sprint ${sprintId} is already closed`);
  }

  // Create the replacement sprint first so the tenant never ends up without
  // an OPEN sprint (PLAN §3.3 — new sprint precedes closing the old one).
  // scoped() injects tenantId at runtime; the input type still requires it,
  // so cast like the route handlers do (src/app/api/order/route.ts).
  const newSprint = await db.sprint.create({
    data: {
      startAt: new Date(),
      status: SprintStatus.OPEN,
    } as unknown as Parameters<typeof prisma.sprint.create>[0]["data"],
  });

  // Optimistic guard: only close if still OPEN (race-safe, PLAN §7.6).
  const closed = await db.sprint.updateMany({
    where: { id: sprintId, status: SprintStatus.OPEN },
    data: { status: SprintStatus.CLOSED, endAt: new Date(), closedAt: new Date() },
  });
  if (closed.count === 0) {
    // Lost the race — a concurrent close already shut this sprint. Undo the
    // fresh sprint we just created (it has no orders yet) and report 409.
    await db.sprint.deleteMany({ where: { id: newSprint.id } });
    throw new HttpError(409, `Sprint ${sprintId} is already closed`);
  }

  const { count: carriedOver } = await db.order.updateMany({
    where: { sprintId, status: { in: [...CARRY_OVER_STATUSES] } },
    data: { sprintId: newSprint.id },
  });

  // ETA recalc for the orders now queued in the new sprint (PLAN §3.3, §7.5).
  await recalculateQueueEtas(db, tenantId, prepTimeBuffer);

  const archived = await db.order.count({
    where: { sprintId, status: { in: [...ARCHIVED_STATUSES] } },
  });

  return { newSprintId: newSprint.id, carriedOver, archived };
}
