/**
 * POST /api/order — create an order (status PENDING, payment UNPAID).
 * PLAN §9.1 / §3.2. Guards: effective open state (schedule auto + time-boxed
 * toggle override, issue #207), order cap (PLAN §4.3 / issue #6). ETA =
 * FIFO queue ahead + own prep (PLAN §4.2, lib/queue.ts).
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, HttpError, readJson } from "@/lib/api";
import { effectiveOpen } from "@/lib/open";
import { fetchQueue, etaForNewOrder, withBuffer, isQueueFull } from "@/lib/queue";
import { effectiveMaxQueueSize, getLimit } from "@/lib/plan";
import { PaymentMethod } from "@/generated/prisma/enums";
import { isValidSlug, NAME_MAX, PHONE_MAX, hasLengthAtMost } from "@/lib/validation";
import { isValidUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

const PAYMENT_METHODS = new Set<string>(["qris", "bank_transfer", "cash"]);

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body", 400);

  const slug = typeof body.slug === "string" ? body.slug : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim() : "";
  const itemsRaw = Array.isArray(body.items) ? body.items : [];
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : undefined;
  // T17-6: optional account binding — attach when the customer is logged in.
  const customerId = typeof body.customerId === "string" ? body.customerId : undefined;

  if (!slug || !customerName || !customerPhone) {
    return fail("slug, customerName, customerPhone are required", 400);
  }
  // Issue #252: format + length guards before any DB work.
  if (!isValidSlug(slug)) return fail("Invalid slug format", 400);
  if (!hasLengthAtMost(customerName, NAME_MAX))
    return fail(`customerName maksimal ${NAME_MAX} karakter`, 400);
  if (!hasLengthAtMost(customerPhone, PHONE_MAX))
    return fail(`customerPhone maksimal ${PHONE_MAX} karakter`, 400);
  if (customerId !== undefined && !isValidUuid(customerId))
    return fail("customerId must be a valid UUID", 400);
  if (itemsRaw.length === 0) return fail("items[] must contain at least one item", 400);
  if (paymentMethod !== undefined && !PAYMENT_METHODS.has(paymentMethod)) {
    return fail("paymentMethod must be qris, bank_transfer or cash", 400);
  }

  let items: { menuItemId: string; quantity: number }[];
  try {
    items = itemsRaw.map((it) => {
      const row = it as Record<string, unknown>;
      const menuItemId = typeof row.menuItemId === "string" ? row.menuItemId : "";
      const quantity = Math.floor(Number(row.quantity));
      if (!menuItemId || !Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
        throw new HttpError(400, "Each item needs menuItemId (string) and quantity (1-99)");
      }
      return { menuItemId, quantity };
    });
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return fail("Tenant not found", 404);

  // T8: isActive gate — a soft-disabled tenant (isActive=false) refuses all
  // new orders with 403 Forbidden. This is an account/billing-level toggle,
  // distinct from the per-day open/close schedule below (issue #229).
  if (!tenant.isActive) return fail("Tenant is not active", 403);

  // #207 v2: schedule is authoritative; the Buka/Tutup toggle is a time-boxed
  // override (isOpenOverrideUntil). effectiveOpen() = override while active,
  // else operating-hours check.
  if (!effectiveOpen(tenant)) return fail("Shop is closed", 422);

  try {
    // ORDER-10 (plan §8, Option A): serialize queue-cap check + order creation
    // per tenant. A Postgres advisory transaction lock on a deterministic
    // tenant-scoped key makes check-then-create atomic — two concurrent
    // requests can no longer both pass the cap. The lock is acquired inside
    // the same transaction as the create, so it auto-releases on commit or
    // rollback, and the key is derived from tenant.id so tenant A's orders
    // never block tenant B. (signed 32-bit fnv-1a style hash → int4 key;
    // Postgres auto-casts to bigint for pg_advisory_xact_lock)
    const lockKey = tenant.id
      .split("")
      .reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);

    const order = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      // NOTE: reads/writes use `tx` directly with explicit tenantId filters —
      // the scoped() wrapper must not wrap a transaction client (Prisma's
      // deepCloneArgs breaks on the double proxy: "'ownKeys' on proxy: trap
      // result did not include '$on'").

      // T8: monthly order cap (issue #229). FREE plans are limited to 300
      // orders per calendar month; PRO is unlimited (getLimit returns
      // Infinity). Count orders created in the current month for this tenant
      // and refuse with 429 once the cap is reached. Runs inside the advisory
      // lock so concurrent requests can't both slip under the cap.
      const orderPerMonth = getLimit(tenant.plan, "orderPerMonth");
      if (Number.isFinite(orderPerMonth)) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthOrderCount = await tx.order.count({
          where: { tenantId: tenant.id, createdAt: { gte: monthStart } },
        });
        if (monthOrderCount >= orderPerMonth) {
          throw new HttpError(
            429,
            `Monthly order limit reached (${orderPerMonth}). Upgrade to PRO for unlimited orders.`,
            { upgradeUrl: "/pricing?utm=limit" }
          );
        }
      }

      // Order cap (PLAN §4.3 / issue #6): refuse once the FIFO queue is full.
      // T9 (issue #229): the cap is the plan-aware effectiveMaxQueueSize —
      // min(tenant.maxQueueSize, planCeiling). FREE is hard-capped at 20
      // even if the tenant column says higher; PRO is capped at 100.
      const queue = await fetchQueue(tx, tenant.id);
      const cap = effectiveMaxQueueSize(tenant);
      if (isQueueFull(queue.length, cap)) {
        throw new HttpError(429, "Order queue is full — please try again in a few minutes");
      }

      // ORDER-07: aggregate duplicate menuItemIds — a customer adding the same
      // item twice should produce ONE OrderItem row with the summed quantity
      // (e.g. "Kopi Susu x2" instead of two separate "Kopi Susu x1" rows).
      const aggregated = new Map<string, number>();
      for (const item of items) {
        aggregated.set(item.menuItemId, (aggregated.get(item.menuItemId) || 0) + item.quantity);
      }
      const uniqueItems: { menuItemId: string; quantity: number }[] = Array.from(
        aggregated,
        ([menuItemId, quantity]) => ({ menuItemId, quantity })
      );

      // Menu item validation can also fail (unavailable / foreign item) — it
      // runs inside the tx so its HttpError aborts the transaction and
      // becomes a clean 4xx response.
      const ids = Array.from(new Set(uniqueItems.map((i) => i.menuItemId)));
      const menuItems = await tx.menuItem.findMany({
        where: { id: { in: ids }, isAvailable: true, tenantId: tenant.id },
      });
      if (menuItems.length !== ids.length) {
        throw new HttpError(422, "One or more menu items are unavailable");
      }

      const byId = new Map(menuItems.map((m) => [m.id, m]));
      const orderItems = uniqueItems.map((i) => {
        const menuItem = byId.get(i.menuItemId)!;
        return {
          menuItemId: menuItem.id,
          quantity: i.quantity,
          unitPrice: menuItem.price, // snapshot price at order time
        };
      });

      const ownPrepSeconds = orderItems.reduce(
        (acc, oi) => acc + (byId.get(oi.menuItemId)?.prepTimeSeconds ?? 0) * oi.quantity,
        0
      );
      // FIFO queue ETA (PLAN §4.2): everything ahead + own prep + tenant buffer.
      const etaSeconds = withBuffer(etaForNewOrder(queue, ownPrepSeconds), tenant.prepTimeBuffer);

      // T15 §2.2: auto-assign the order to the tenant's OPEN sprint. If no
      // sprint is OPEN yet (first order after the migration), auto-create one
      // (startAt = now). Runs inside the same tx as the order create, so the
      // advisory lock also serializes sprint auto-creation. One-open-sprint is
      // enforced at the app layer; tenantId filter keeps it tenant-scoped
      // (this tx client is unscoped by design — see NOTE above).
      let activeSprint = await tx.sprint.findFirst({
        where: { tenantId: tenant.id, status: "OPEN" },
        select: { id: true },
      });
      if (!activeSprint) {
        activeSprint = await tx.sprint.create({
          data: {
            tenantId: tenant.id,
            startAt: new Date(),
            status: "OPEN",
          } as unknown as Parameters<typeof prisma.sprint.create>[0]["data"],
          select: { id: true },
        });
      }

      // T16 PICKUP-01: generate a 4-digit pickup PIN (1000-9999) at order
      // create. Stored on the order; verified by the barista on
      // READY_FOR_PICKUP → PICKED_UP (see admin/orders/[orderId]/route.ts).
      const pickupCode = String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999

      return tx.order.create({
        data: {
          tenantId: tenant.id,
          customerName,
          customerPhone,
          customerId: customerId ?? null, // T17-6: optional account binding
          etaSeconds,
          etaCalculatedAt: new Date(),
          paymentMethod: paymentMethod as PaymentMethod | undefined,
          sprintId: activeSprint.id,
          pickupCode, // ← ADD THIS
          items: { create: orderItems },
          statusLogs: { create: { status: "PENDING", note: "Order created" } },
        } as unknown as Parameters<typeof prisma.order.create>[0]["data"],
        select: { id: true, status: true, etaSeconds: true },
      });
    });

    return ok({ orderId: order.id, status: order.status, etaSeconds: order.etaSeconds }, 201);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status, e.extra);
    throw e;
  }
}
