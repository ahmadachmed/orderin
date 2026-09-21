import Link from "next/link";
import { LegalSection } from "@/components/legal/LegalPage";

/**
 * Kebijakan Privasi (UU PDP) — shared body for the platform landing
 * (variant="platform") and each tenant shopfront (variant="tenant").
 * Honest description of what the app actually collects and does today.
 */
export function PrivacyContent({
  tenantSlug,
  variant,
}: {
  tenantSlug?: string;
  variant: "platform" | "tenant";
}) {
  const operator =
    variant === "tenant"
      ? "kedai yang Anda pesan, melalui platform HeadwayBrew"
      : "HeadwayBrew";
  const termsHref = tenantSlug ? `/${tenantSlug}/terms` : "/terms";

  return (
    <>
      <LegalSection title="1. Data yang Kami Kumpulkan">
        <p>
          Saat Anda membuat akun, {operator} mengumpulkan nama dan nomor HP
          Anda. Kami juga menyimpan riwayat pesanan Anda (menu yang dipesan,
          jumlah, harga, status pesanan, dan metode pembayaran) serta waktu
          pembuatan akun.
        </p>
        <p>
          Data tersebut dikumpulkan hanya sebatas yang diperlukan untuk
          menjalankan layanan pemesanan.
        </p>
      </LegalSection>

      <LegalSection title="2. Tujuan Penggunaan Data">
        <p>Data Anda digunakan untuk:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>memproses, mengonfirmasi, dan memperbarui status pesanan Anda;</li>
          <li>menghubungi Anda terkait pesanan melalui nomor HP yang Anda daftarkan;</li>
          <li>menyediakan riwayat pesanan dan akses akun lintas perangkat;</li>
          <li>memberikan dukungan saat Anda membutuhkan bantuan.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Dasar Pemrosesan dan Persetujuan">
        <p>
          Pemrosesan data pribadi Anda dilakukan berdasarkan persetujuan
          eksplisit yang Anda berikan saat mendaftar, sesuai dengan Undang-Undang
          No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP). Dengan
          mencentang kotak persetujuan pada formulir pendaftaran, Anda menyatakan
          setuju terhadap kebijakan ini.
        </p>
        <p>
          Anda dapat menarik kembali persetujuan tersebut kapan saja dengan
          menghubungi admin kedai atau {operator}.
        </p>
      </LegalSection>

      <LegalSection title="4. Hak Anda atas Data Pribadi">
        <p>Anda berhak untuk:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>mengakses data pribadi yang kami simpan tentang Anda;</li>
          <li>meminta koreksi apabila data tidak akurat;</li>
          <li>meminta penghapusan akun dan data pribadi Anda;</li>
          <li>menarik kembali persetujuan pemrosesan data.</li>
        </ul>
        <p>
          Untuk menggunakan hak tersebut, hubungi admin kedai tempat Anda
          berbelanja atau tim {operator}. Permintaan penghapusan akun akan kami
          proses sesuai ketentuan yang berlaku.
        </p>
      </LegalSection>

      <LegalSection title="5. Retensi Data">
        <p>
          Data pribadi Anda disimpan selama akun masih aktif atau selama
          diperlukan untuk keperluan pelayanan dan pemenuhan kewajiban hukum.
          Setelah akun dihapus, data pribadi Anda akan dihapus atau
          dianonimkan sesuai ketentuan yang berlaku.
        </p>
      </LegalSection>

      <LegalSection title="6. Berbagi Data dengan Pihak Ketiga">
        <p>
          Kami tidak menjual, menyewakan, atau membagikan data pribadi Anda
          kepada pihak ketiga untuk kepentingan komersial. Data hanya dapat
          dibuka apabila diwajibkan oleh hukum atau peraturan perundang-undangan
          yang berlaku.
        </p>
      </LegalSection>

      <LegalSection title="7. Keamanan Data">
        <p>
          Kata sandi Anda disimpan dalam bentuk terenkripsi (hash) dan akses ke
          data pribadi dibatasi hanya untuk keperluan operasional layanan.
        </p>
      </LegalSection>

      <LegalSection title="8. Perubahan Kebijakan">
        <p>
          Kebijakan ini dapat diperbarui dari waktu ke waktu. Perubahan akan
          ditampilkan di halaman ini dengan tanggal pembaruan terbaru.
        </p>
      </LegalSection>

      <LegalSection title="9. Kontak">
        <p>
          Jika Anda memiliki pertanyaan tentang kebijakan privasi ini, hubungi
          admin kedai atau tim {operator}. Silakan baca juga{" "}
          <Link href={termsHref} className="font-medium text-primary hover:underline">
            Syarat &amp; Ketentuan
          </Link>{" "}
          kami.
        </p>
      </LegalSection>
    </>
  );
}
