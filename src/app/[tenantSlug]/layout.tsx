/**
 * [tenantSlug] layout — public shop shell (mobile-web-first).
 * Wraps the menu page and the order status page.
 */
export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto max-w-md px-4 pt-4">{children}</div>
    </div>
  );
}
