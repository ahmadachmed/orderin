import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { TermsContent } from "@/components/legal/TermsContent";

export const metadata: Metadata = {
  title: "Syarat & Ketentuan — HeadwayBrew",
  description:
    "Syarat dan Ketentuan penggunaan layanan HeadwayBrew untuk pemesanan kopi takeaway.",
};

export default function PlatformTermsPage() {
  return (
    <LegalPage title="Syarat & Ketentuan" updatedAt="28 Agustus 2026">
      <TermsContent variant="platform" />
    </LegalPage>
  );
}
