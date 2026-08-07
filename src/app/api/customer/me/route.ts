/**
 * GET /api/customer/me — lightweight customer session probe (T17-6).
 * Returns { loggedIn: true, customerId } when a valid customer session
 * cookie is present, { loggedIn: false } otherwise. Used by OrderForm to
 * auto-attach customerId to new orders.
 */
import { ok } from "@/lib/api";
import { getCustomerSession } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = getCustomerSession();
  if (!session) return ok({ loggedIn: false });
  return ok({ loggedIn: true, customerId: session.customerId });
}
