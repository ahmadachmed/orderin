import Link from "next/link";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2 ${className ?? ""}`}
      aria-label="HeadwayBrew — Beranda"
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-primary"
        aria-hidden="true"
      >
        <path
          d="M8 14c0-3.314 2.686-6 6-6h4c3.314 0 6 2.686 6 6v6a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-6Z"
          fill="currentColor"
        />
        <path
          d="M24 16h2a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-2"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M12 6c0-1.5 1-2.5 2-3M16 5c0-1.5 1-2.5 2-3M20 6c0-1.5 1-2.5 2-3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-lg font-extrabold tracking-tight text-foreground">
        HeadwayBrew
      </span>
    </Link>
  );
}
