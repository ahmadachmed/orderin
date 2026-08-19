import type { MetadataRoute } from "next";

/** Absolute URL base for public links (env-driven, defaults to production). */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "https://headwaybrew.com";

/** robots.txt (issue #250): allow all crawlers, point at the sitemap. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
