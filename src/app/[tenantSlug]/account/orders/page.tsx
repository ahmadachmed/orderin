import { cookies } from "next/headers";
import { verifyCustomerSession } from "@/lib/customer-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import AccountOrdersList from "@/components/AccountOrdersList";

export const dynamic = "force-dynamic";

export default async function AccountOrdersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = verifyCustomerSession((await cookies()).get("orderin_customer_session")?.value);
  // T20 ACCT-03 (docs/T18-plan.md GAP 2): no silent redirect — send guests to
  // login with ?next so they land back here after authenticating.
  if (!session) redirect(`/${tenantSlug}/login?next=account/orders`);
  if (session.tenantSlug !== tenantSlug) notFound();

  return (
    // -mx-4/-mt-4 cancel the shared layout's px-4 pt-4 so the dark page bg
    // spans the whole column (kanon history.html — dark-first).
    <main className="-mx-4 -mt-4 min-h-screen bg-background px-4 pb-10 pt-4">
      <header className="mb-4">
        <Link href={`/${tenantSlug}`} className="text-xs font-medium text-muted-foreground">
          ← Kembali ke menu
        </Link>
        <h1 className="mt-1 text-xl font-extrabold tracking-tight text-foreground">
          Riwayat Pesanan
        </h1>
      </header>
      <AccountOrdersList tenantSlug={tenantSlug} />
    </main>
  );
}
