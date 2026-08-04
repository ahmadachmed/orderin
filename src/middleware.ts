/**
 * T12 (issue #23): per-route rate limiting for the public API.
 *
 * Next.js App Router middleware (src/middleware.ts — required location for
 * Next 14.x with a src/ directory). Runs on the Edge runtime BEFORE route
 * handlers, so limited requests never touch the DB. Pure in-memory — the
 * store lives in src/lib/rate-limit.ts and never reads the database.
 *
 * Limited routes (config in src/lib/rate-limit.ts):
 *   POST /api/register   60s / 3   -> 429 + Retry-After
 *   POST /api/admin/auth 60s / 5   -> 429 + Retry-After
 *   POST /api/order      10s / 10  -> 429 + Retry-After
 *   GET  /api/slug-check 10s / 20  -> 429
 *
 * Every response carries X-RateLimit-Remaining and X-RateLimit-Reset.
 * All other routes pass through untouched (NextResponse.next()).
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, ROUTE_RATE_LIMITS } from "@/lib/rate-limit";

export const config = {
  matcher: "/api/:path*",
};

/** Best-effort client IP: x-forwarded-for (first hop), then x-real-ip. */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function applyHeaders(
  res: NextResponse,
  remaining: number,
  resetAt: number
): NextResponse {
  res.headers.set("X-RateLimit-Remaining", String(remaining));
  res.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const pathname = req.nextUrl.pathname;
  const routeKey = `${req.method} ${pathname}`;

  // Not a rate-limited route -> pass through untouched.
  if (!ROUTE_RATE_LIMITS[routeKey]) {
    return NextResponse.next();
  }

  const result = checkRateLimit(clientIp(req), routeKey);

  if (result.ok) {
    return applyHeaders(NextResponse.next(), result.remaining, result.resetAt);
  }

  const res = NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
      },
    }
  );
  return applyHeaders(res, result.remaining, result.resetAt);
}
