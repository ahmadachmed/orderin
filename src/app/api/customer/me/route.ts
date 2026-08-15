/**
 * GET /api/customer/me — customer session probe (T17-6 + issue #231).
 * Returns { loggedIn: true, customerId, name, phone } when a valid customer
 * session cookie is present (name+phone fetched from DB so OrderForm can
 * pre-fill them), { loggedIn: false } otherwise.
 */
import { ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCustomerSession } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return ok({ loggedIn: false });

  // Fetch name + phone from DB so OrderForm can pre-fill them (issue #231).
  const customer = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: { name: true, phone: true },
  });

  // Customer row may have been deleted after the session was issued;
  // treat that as logged-out rather than returning stale data.
  if (!customer) return ok({ loggedIn: false });

  return ok({
    loggedIn: true,
    customerId: session.customerId,
    name: customer.name,
    phone: customer.phone,
  });
}
