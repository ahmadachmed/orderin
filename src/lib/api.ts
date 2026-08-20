/** Shared API response helpers + error type for route handlers. */
import { NextResponse } from "next/server";

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Throw inside a route's scoped() block to short-circuit with a clean HTTP error. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Parse a JSON request body; returns null on malformed input. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort client IP for rate limiting — x-forwarded-for (first hop) then
 * x-real-ip, falling back to "unknown" (Vercel sets x-forwarded-for).
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}
