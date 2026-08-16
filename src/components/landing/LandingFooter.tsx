import Link from "next/link";
import { Logo } from "@/components/landing/Logo";

/**
 * Footer (T29, konsep landingpage2.html). D8: link "Masuk" DIHAPUS dari
 * landing; link register "Daftar Kedai" TETAP.
 */
export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-6 px-6 py-8 md:flex-row md:px-12">
        <div className="flex flex-col items-center gap-2 md:items-start">
          <Logo />
          <p className="text-center text-sm text-muted-foreground md:text-left">
            Takeaway kopi premium yang lebih cerdas.
          </p>
        </div>
        <nav className="flex flex-wrap justify-center gap-6">
          <Link
            href="/register"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Daftar Kedai
          </Link>
        </nav>
        <div className="text-sm text-muted-foreground">
          &copy; {year} HeadwayBrew. Semua hak dilindungi.
        </div>
      </div>
    </footer>
  );
}
