import { scoped } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { getCustomerSession } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return fail("Unauthorized", 401);

  const db = scoped(session.tenantId);
  const orders = await db.order.findMany({
    where: { customerId: session.customerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      items: {
        // Deterministic summary order (issue #252): nested-create row order
        // is not guaranteed, so sort by name.
        include: { menuItem: { select: { name: true } } },
        orderBy: { menuItem: { name: "asc" } },
      },
    },
    take: 50,
  });

  return ok(
    orders.map((o) => ({
      orderId: o.id,
      status: o.status,
      createdAt: o.createdAt,
      itemCount: o.items.reduce((sum, it) => sum + it.quantity, 0),
      summary: o.items.map((it) => `${it.quantity}× ${it.menuItem.name}`).join(", "),
    }))
  );
}
