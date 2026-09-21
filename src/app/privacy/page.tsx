import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PrivacyContent } from "@/components/legal/PrivacyContent";

export const metadata: Metadata = {
  title: "Kebijakan Privasi — HeadwayBrew",
  description:
    "Kebijakan Privasi HeadwayBrew: data yang dikumpulkan, tujuan penggunaan, dan hak Anda sesuai UU PDP.",
};

export default function PlatformPrivacyPage() {
  return (
    <LegalPage title="Kebijakan Privasi" updatedAt="28 Agustus 2026">
      <PrivacyContent variant="platform" />
    </LegalPage>
  );
}
