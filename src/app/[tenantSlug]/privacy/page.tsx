import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PrivacyContent } from "@/components/legal/PrivacyContent";

export const metadata: Metadata = {
  title: "Kebijakan Privasi",
  description:
    "Kebijakan Privasi kedai: data yang dikumpulkan, tujuan penggunaan, dan hak Anda sesuai UU PDP.",
};

/**
 * /[tenantSlug]/privacy — shopfront privacy policy (UU PDP).
 * Static content; the tenant scope only changes cross-links.
 */
export default async function TenantPrivacyPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return (
    <LegalPage title="Kebijakan Privasi" updatedAt="28 Agustus 2026">
      <PrivacyContent tenantSlug={tenantSlug} variant="tenant" />
    </LegalPage>
  );
}
