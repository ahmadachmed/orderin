/**
 * GET /api/slug-check?slug=xxx — debounced availability check (T8).
 * Public endpoint, no auth required.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/api";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug") ?? "";

  if (!slug || slug.length < 3 || slug.length > 50 || !SLUG_RE.test(slug)) {
    return fail("Invalid slug format", 400);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });

  return ok({ available: !tenant });
}
