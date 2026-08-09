/**
 * GET/POST /api/admin/menu — list all items (incl. unavailable) / create item.
 * PLAN §9.2. Both run through scoped() → extension scopes them.
 */
import { NextRequest } from "next/server";
import { prisma, scoped } from "@/lib/prisma";
import { ok, fail, HttpError, readJson } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { parseMenuFields } from "@/lib/menu-fields";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  const items = await scoped(session.tenantId).menuItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      imageUrl: true,
      prepTimeSeconds: true,
      isAvailable: true,
      sortOrder: true,
    },
  });
  return ok({ items });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body", 400);

  try {
    const data = parseMenuFields(body);
    if (data.name === undefined) return fail("name is required", 400);
    if (data.price === undefined) return fail("price is required", 400);

    const item = await scoped(session.tenantId).menuItem.create({
      data: data as unknown as Parameters<typeof prisma.menuItem.create>[0]["data"],
    });
    return ok(item, 201);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }
}
