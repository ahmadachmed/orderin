import Link from "next/link";
import { prisma } from "@/lib/db";
import { TenantSummary } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Landing page — shop list (PLAN §8 / issue #4).
 * Server-rendered from DB: there is no public "list tenants" endpoint in
 * §9.1, so the landing page reads directly (unscoped Tenant lookup).
 */
export default async function Home() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      address: true,
      phone: true,
      isOpen: true,
      openTime: true,
      closeTime: true,
    },
  });

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">Orderin</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Pesan kopi lebih dulu, ambil saat sudah siap — tanpa antre.
        </p>
      </header>

      {tenants.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-500">
          Belum ada kedai terdaftar.
        </p>
      ) : (
        <ul className="space-y-3">
          {tenants.map((t: TenantSummary) => (
            <li key={t.slug}>
              <Link
                href={`/${t.slug}`}
                className="block rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition active:scale-[0.99] active:border-neutral-300"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-neutral-900">{t.name}</h2>
                    {t.address ? (
                      <p className="mt-0.5 truncate text-sm text-neutral-500">{t.address}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-neutral-400">
                      Buka {t.openTime}–{t.closeTime} UTC · {t.phone ?? "—"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      t.isOpen ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {t.isOpen ? "Buka" : "Tutup"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
