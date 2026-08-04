/**
 * GET /api/admin/sprints — list every sprint for the admin's tenant
 * (newest first, PLAN §2.1/§2.3). Each row carries its order count and
 * on-the-fly revenue (Σ PAID order totals — no aggregate table).
 * POST /api/admin/sprints — open a fresh sprint. If a sprint is already
 * OPEN, it is auto-closed first (carry-over logic, PLAN §2.3/§3.2) so the
 * tenant always has exactly one OPEN sprint afterwards.
 */
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, HttpError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { closeSprint, getActiveSprint } from "@/lib/sprint";
import { PaymentStatus, SprintStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = getSession();
  if (!session) return fail("Unauthorized", 401);

  const db = scoped(session.tenantId);
  const sprints = await db.sprint.findMany({
    orderBy: { startAt: "desc" },
    include: { _count: { select: { orders: true } } },
  });

  // Omzet per sprint (Σ PAID) — on-the-fly, no aggregate table (PLAN §2.3).
  // One query for every sprint's paid orders, grouped in memory.
  const paidOrders = await db.order.findMany({
    where: {
      sprintId: { in: sprints.map((s) => s.id) },
      paymentStatus: PaymentStatus.PAID,
    },
    include: { items: { select: { quantity: true, unitPrice: true } } },
  });
  const revenueBySprint = new Map<string, number>();
  for (const o of paidOrders) {
    if (!o.sprintId) continue;
    const total = o.items.reduce(
      (acc, i) => acc + Number(i.unitPrice) * i.quantity,
      0
    );
    revenueBySprint.set(o.sprintId, (revenueBySprint.get(o.sprintId) ?? 0) + total);
  }

  return ok({
    sprints: sprints.map((s) => ({
      id: s.id,
      startAt: s.startAt,
      endAt: s.endAt,
      status: s.status,
      closedAt: s.closedAt,
      orderCount: s._count.orders,
      revenue: revenueBySprint.get(s.id) ?? 0,
    })),
  });
}

export async function POST() {
  const session = getSession();
  if (!session) return fail("Unauthorized", 401);

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { prepTimeBuffer: true },
  });

  try {
    const active = await getActiveSprint(session.tenantId);
    const db = scoped(session.tenantId);

    if (active) {
      // Auto-close the existing OPEN sprint (carry-over, PLAN §3.3) —
      // closeSprint() creates the replacement sprint itself.
      const res = await closeSprint(session.tenantId, active.id, tenant?.prepTimeBuffer ?? 0);
      const sprint = await db.sprint.findFirst({ where: { id: res.newSprintId } });
      return ok(
        {
          sprint,
          autoClosed: true,
          carriedOver: res.carriedOver,
          archived: res.archived,
        },
        201
      );
    }

    const sprint = await db.sprint.create({
      data: {
        startAt: new Date(),
        status: SprintStatus.OPEN,
      } as unknown as Parameters<typeof prisma.sprint.create>[0]["data"],
    });
    return ok({ sprint, autoClosed: false }, 201);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }
}
