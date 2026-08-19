/**
 * POST /api/admin/sprints/[sprintId]/close — close a sprint manually
 * (PLAN §2.1/§2.3, §3.2). Carries active orders into a fresh OPEN sprint,
 * archives picked-up/cancelled orders, recalculates queue ETAs. 404 for
 * unknown sprints, 409 when already CLOSED (race-safe, PLAN §7.6).
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, HttpError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { closeSprint } from "@/lib/sprint";
import { isValidUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const { sprintId } = await params;
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  // Issue #252: non-UUID sprintId → Prisma uuid cast error → 500. 404 instead.
  if (!isValidUuid(sprintId)) return fail("Sprint not found", 404);

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { prepTimeBuffer: true },
  });

  try {
    const res = await closeSprint(
      session.tenantId,
      sprintId,
      tenant?.prepTimeBuffer ?? 0
    );
    return ok(res);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }
}
