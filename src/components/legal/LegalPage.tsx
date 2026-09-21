/**
 * Shared shell for legal pages (UU PDP) — consistent, readable layout for
 * privacy policy and terms pages on both the platform landing and tenant
 * shopfronts.
 */
export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Terakhir diperbarui: {updatedAt}
        </p>
        <div className="mt-6 space-y-6">{children}</div>
      </div>
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-base font-bold text-foreground">{title}</h2>
      <div className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
