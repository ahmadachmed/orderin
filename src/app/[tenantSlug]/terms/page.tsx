import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { TermsContent } from "@/components/legal/TermsContent";

export const metadata: Metadata = {
  title: "Syarat & Ketentuan",
  description:
    "Syarat dan Ketentuan penggunaan layanan pemesanan di kedai ini.",
};

/**
 * /[tenantSlug]/terms — shopfront terms of service (UU PDP).
 * Static content; the tenant scope only changes cross-links.
 */
export default async function TenantTermsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return (
    <LegalPage title="Syarat & Ketentuan" updatedAt="28 Agustus 2026">
      <TermsContent tenantSlug={tenantSlug} variant="tenant" />
    </LegalPage>
  );
}
