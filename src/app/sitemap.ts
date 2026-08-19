import type { MetadataRoute } from "next";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Absolute URL base for public links (env-driven, defaults to production). */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "https://headwaybrew.com";

/**
 * Dynamic sitemap (issue #250): root `/` + one URL per active tenant shop.
 * Same tenant-list query pattern as the landing page (src/app/page.tsx).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { slug: true, updatedAt: true },
  });

  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    ...tenants.map((tenant) => ({
      url: `${SITE_URL}/${tenant.slug}`,
      lastModified: tenant.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
