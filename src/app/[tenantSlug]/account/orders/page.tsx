import { cookies } from "next/headers";
import { verifyCustomerSession } from "@/lib/customer-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import AccountOrdersList from "@/components/AccountOrdersList";

export const dynamic = "force-dynamic";

export default async function AccountOrdersPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const session = verifyCustomerSession(cookies().get("orderin_customer_session")?.value);
  if (!session) redirect(`/${params.tenantSlug}`);
  if (session.tenantSlug !== params.tenantSlug) notFound();

  return (
    <main className="pb-10">
      <header className="mb-4">
        <Link href={`/${params.tenantSlug}`} className="text-xs font-medium text-neutral-400">
          ← Kembali ke menu
        </Link>
        <h1 className="mt-1 text-xl font-extrabold tracking-tight text-neutral-900">
          Riwayat Pesanan
        </h1>
      </header>
      <AccountOrdersList tenantSlug={params.tenantSlug} />
    </main>
  );
}
