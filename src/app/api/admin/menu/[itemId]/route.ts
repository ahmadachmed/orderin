/**
 * PATCH/DELETE /api/admin/menu/[itemId] — update / delete a menu item.
 * PLAN §9.2. Updates run as scoped updateMany (count-checked); deletes refuse
 * items still referenced by order history (FK integrity).
 */
import { NextRequest } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, HttpError, readJson } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { parseMenuFields } from "@/lib/menu-fields";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body", 400);

  try {
    const data = parseMenuFields(body);
    if (Object.keys(data).length === 0) return fail("Nothing to update", 400);

    const db = scoped(session.tenantId);
    const res = (await db.menuItem.update({
      where: { id: itemId },
      data,
    })) as unknown as { count: number };
    if (res.count === 0) throw new HttpError(404, "Menu item not found");
    const updated = await db.menuItem.findFirst({
      where: { id: itemId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        price: true,
        imageUrl: true,
        prepTimeSeconds: true,
        isAvailable: true,
        sortOrder: true,
      },
    });

    return ok(updated);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  try {
    const db = scoped(session.tenantId);
    // Refuse if referenced by any order (snapshot integrity).
    const refs = await prisma.orderItem.count({
      where: { menuItemId: itemId },
    });
    if (refs > 0) {
      throw new HttpError(409, "Menu item is referenced by orders and cannot be deleted");
    }
    const res = (await db.menuItem.delete({
      where: { id: itemId },
    })) as unknown as { count: number };
    if (res.count === 0) throw new HttpError(404, "Menu item not found");

    return ok({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }
}
