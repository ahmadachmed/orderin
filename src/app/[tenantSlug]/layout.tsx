import Link from "next/link";

/**
 * [tenantSlug] layout — public shop shell (mobile-web-first).
 * Wraps the menu page and the order status page.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto max-w-md px-4 pt-4">{children}</div>
      {/* UU PDP — legal links on every customer-facing shopfront page */}
      <footer className="mx-auto max-w-md px-4 pb-6 pt-8">
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <Link
            href={`/${tenantSlug}/privacy`}
            className="transition-colors hover:text-foreground"
          >
            Kebijakan Privasi
          </Link>
          <Link
            href={`/${tenantSlug}/terms`}
            className="transition-colors hover:text-foreground"
          >
            Syarat &amp; Ketentuan
          </Link>
        </nav>
      </footer>
    </div>
  );
}
