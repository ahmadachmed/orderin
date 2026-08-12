/**
 * Queue & ETA calculation — T5 (issue #6, PLAN §4).
 *
 * FIFO queue per tenant: every order with status in QUEUE_STATUSES
 * (pending, confirmed, brewing), ordered by createdAt (FIFO; id tiebreak
 * for equal timestamps). READY_FOR_PICKUP / PICKED_UP / CANCELLED orders
 * are out of the queue.
 *
 * ETA is a DURATION in seconds (PLAN §7.3 — timezone-free; the presentation
 * layer converts to wall-clock time). Per PLAN §4.2:
 *
 *   eta = Σ (prep_time_seconds × qty) of every order AHEAD in the queue
 *         + own Σ (prep_time_seconds × qty)
 *
 * The tenant's prepTimeBuffer (minutes, PLAN §7.2) is folded in via
 * withBuffer() at every call site so all stored etaSeconds values are
 * uniform: queue-sum + own + buffer.
 *
 * Order cap (PLAN §4.3 / issue #6): at most Tenant.maxQueueSize orders may
 * be in the queue; POST /api/order refuses new orders once it is full.
 *
 * DB access always goes through a tenant-scoped client (scoped(tenantId))
 * — this module never touches an unscoped client itself; callers pass one.
 */

export const QUEUE_STATUSES = ["PENDING", "CONFIRMED", "BREWING"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** A normalized queue entry: the order's total prep seconds (Σ prep × qty). */
export interface QueueEntry {
  id: string;
  createdAt: Date;
  prepSeconds: number;
}

/** Σ (prep_time_seconds × qty) for one order's items. */
export function prepSecondsForItems(
  items: readonly { quantity: number; menuItem: { prepTimeSeconds: number } }[]
): number {
  return items.reduce((acc, oi) => acc + oi.menuItem.prepTimeSeconds * oi.quantity, 0);
}

/** Pure FIFO sort: oldest first, id tiebreak for equal timestamps. */
export function sortQueue<T extends { id: string; createdAt: Date }>(orders: readonly T[]): T[] {
  return [...orders].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

/**
 * ETA for an order already in the queue: strictly-ahead orders + its own
 * prep (PLAN §4.2 — "created BEFORE this order" = FIFO position). Returns
 * null if orderId is not in the queue.
 */
export function etaForOrderInQueue(
  queue: readonly QueueEntry[],
  orderId: string
): number | null {
  const sorted = sortQueue(queue);
  const idx = sorted.findIndex((e) => e.id === orderId);
  if (idx === -1) return null;
  let total = 0;
  for (let i = 0; i <= idx; i++) total += sorted[i].prepSeconds;
  return total;
}

/**
 * 1-based FIFO position of an order in the queue (T19 / issue #147).
 * Same ordering as etaForOrderInQueue: oldest first, id tiebreak.
 * Returns null when orderId is not in the queue (e.g. non-queue statuses
 * like READY_FOR_PICKUP / PICKED_UP / CANCELLED are simply absent from the
 * queue, so they get null — position 1 means "next to be served").
 */
export function queuePositionForOrder(
  queue: readonly QueueEntry[],
  orderId: string
): number | null {
  const sorted = sortQueue(queue);
  const idx = sorted.findIndex((e) => e.id === orderId);
  return idx === -1 ? null : idx + 1;
}

/** ETA for a brand-new order: everything currently in the queue + own prep. */
export function etaForNewOrder(queue: readonly QueueEntry[], ownPrepSeconds: number): number {
  return sortQueue(queue).reduce((acc, e) => acc + e.prepSeconds, 0) + ownPrepSeconds;
}

/** Order cap check (PLAN §4.3): queue is full at or beyond maxQueueSize. */
export function isQueueFull(activeCount: number, maxQueueSize: number): boolean {
  return activeCount >= maxQueueSize;
}

/** Fold the tenant's prep buffer (minutes) into an ETA (seconds). */
export function withBuffer(etaSeconds: number, prepTimeBufferMinutes: number): number {
  return etaSeconds + prepTimeBufferMinutes * 60;
}

type QueueOrderRow = {
  id: string;
  createdAt: Date;
  items: { quantity: number; menuItem: { prepTimeSeconds: number } }[];
};

/**
 * Fetch the tenant's FIFO queue (oldest first). `db` must be tenant-scoped
 * (scoped(tenantId)); tenantId is passed explicitly anyway so this also
 * works with a plain client that requires explicit scoping.
 */
export async function fetchQueue<T>(db: T, tenantId: string): Promise<QueueEntry[]> {
  const delegate = (db as { order?: unknown }).order as {
    findMany(args: {
      where: { status: { in: readonly string[] }; tenantId: string };
      orderBy: readonly ({ createdAt: "asc" } | { id: "asc" })[];
      include: { items: { include: { menuItem: { select: { prepTimeSeconds: true } } } } };
    }): Promise<QueueOrderRow[]>;
  };
  const rows = await delegate.findMany({
    where: { status: { in: [...QUEUE_STATUSES] }, tenantId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { items: { include: { menuItem: { select: { prepTimeSeconds: true } } } } },
  });
  return rows.map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    prepSeconds: prepSecondsForItems(o.items),
  }));
}

/**
 * Recompute stored etaSeconds/etaCalculatedAt for every order currently in
 * the queue. Call after an order LEAVES the queue (ready_for_pickup,
 * picked_up, cancelled) so the remaining orders' ETAs shrink accordingly
 * (PLAN §4.1 — ETA is recalculated when an order finishes).
 */
export async function recalculateQueueEtas<T>(
  db: T,
  tenantId: string,
  prepTimeBufferMinutes: number
): Promise<void> {
  const queue = await fetchQueue(db, tenantId);
  const delegate = (db as { order?: unknown }).order as {
    updateMany(args: {
      where: { id: string };
      data: { etaSeconds: number; etaCalculatedAt: Date };
    }): Promise<unknown>;
  };
  for (const entry of queue) {
    const eta = etaForOrderInQueue(queue, entry.id);
    if (eta !== null) {
      await delegate.updateMany({
        where: { id: entry.id },
        data: {
          etaSeconds: withBuffer(eta, prepTimeBufferMinutes),
          etaCalculatedAt: new Date(),
        },
      });
    }
  }
}
