import Link from "next/link";
import { LegalSection } from "@/components/legal/LegalPage";

/**
 * Syarat & Ketentuan — shared body for the platform landing
 * (variant="platform") and each tenant shopfront (variant="tenant").
 * Simple, honest usage rules that match how the app behaves today.
 */
export function TermsContent({
  tenantSlug,
  variant,
}: {
  tenantSlug?: string;
  variant: "platform" | "tenant";
}) {
  const operator =
    variant === "tenant"
      ? "kedai tempat Anda berbelanja, melalui platform HeadwayBrew"
      : "HeadwayBrew";
  const privacyHref = tenantSlug ? `/${tenantSlug}/privacy` : "/privacy";

  return (
    <>
      <LegalSection title="1. Layanan">
        <p>
          {operator} menyediakan layanan pemesanan kopi takeaway secara daring.
          Dengan menggunakan layanan ini, Anda dapat melihat menu, melakukan
          pemesanan, dan memantau status pesanan Anda.
        </p>
      </LegalSection>

      <LegalSection title="2. Akun Pengguna">
        <p>
          Untuk membuat akun, Anda wajib memberikan data yang benar dan
          terkini, yaitu nama dan nomor HP yang dapat dihubungi. Anda
          bertanggung jawab menjaga kerahasiaan kata sandi akun Anda. Setiap
          aktivitas yang terjadi melalui akun Anda dianggap dilakukan oleh
          Anda.
        </p>
      </LegalSection>

      <LegalSection title="3. Kewajiban Pengguna">
        <ul className="list-disc space-y-1 pl-5">
          <li>memberikan informasi yang benar saat memesan atau mendaftar;</li>
          <li>tidak menyalahgunakan layanan untuk aktivitas melanggar hukum;</li>
          <li>tidak mencoba mengganggu, meretas, atau membebani sistem layanan;</li>
          <li>menjaga kerahasiaan kata sandi dan informasi akun Anda.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Pesanan dan Pembayaran">
        <p>
          Pesanan hanya dapat diproses pada jam operasional kedai. Harga,
          ketersediaan menu, dan estimasi waktu penyiapan ditetapkan oleh kedai
          dan dapat berubah sewaktu-waktu. Pembayaran dilakukan sesuai metode
          yang disediakan oleh kedai.
        </p>
      </LegalSection>

      <LegalSection title="5. Batasan Tanggung Jawab">
        <p>
          Kedai bertanggung jawab atas menu, harga, kualitas produk, dan
          pelayanan pesanan. {operator} menyediakan infrastruktur teknis untuk
          memproses pesanan dan tidak bertanggung jawab atas kerugian tidak
          langsung yang timbul di luar kendali kami.
        </p>
      </LegalSection>

      <LegalSection title="6. Perubahan Syarat">
        <p>
          Syarat &amp; Ketentuan ini dapat diperbarui dari waktu ke waktu.
          Perubahan akan ditampilkan di halaman ini dengan tanggal pembaruan
          terbaru. Penggunaan layanan setelah perubahan berlaku dianggap sebagai
          persetujuan terhadap syarat terbaru.
        </p>
      </LegalSection>

      <LegalSection title="7. Hukum yang Berlaku">
        <p>
          Syarat ini diatur oleh hukum Negara Republik Indonesia. Silakan baca
          juga{" "}
          <Link href={privacyHref} className="font-medium text-primary hover:underline">
            Kebijakan Privasi
          </Link>{" "}
          kami untuk informasi mengenai pengelolaan data pribadi Anda.
        </p>
      </LegalSection>
    </>
  );
}
