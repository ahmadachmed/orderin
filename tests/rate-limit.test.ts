// @vitest-environment node
/**
 * T12 (issue #23): rate limiting tests.
 * Unit + middleware-level. No DB needed — pure in-memory store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import {
  checkRateLimit,
  ROUTE_RATE_LIMITS,
  _resetRateLimitsForTest,
  _rateLimitStoreSize,
  _sweepExpired,
} from "../src/lib/rate-limit";

function req(
  method: string,
  path: string,
  ip: string,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "x-forwarded-for": ip, ...extraHeaders },
  });
}

describe("middleware — rate limited routes", () => {
  beforeEach(() => {
    _resetRateLimitsForTest();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("POST /api/register: burst max(3)+1 -> 429 with Retry-After", () => {
    for (let i = 0; i < 3; i++) {
      const res = middleware(req("POST", "/api/register", "10.0.0.1"));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(3 - i - 1));
    }
    const blocked = middleware(req("POST", "/api/register", "10.0.0.1"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(blocked.headers.get("Retry-After")).toBe(String(ROUTE_RATE_LIMITS["POST /api/register"].windowMs / 1000));
  });

  it("POST /api/admin/auth: burst max(5)+1 -> 429", () => {
    for (let i = 0; i < 5; i++) {
      expect(middleware(req("POST", "/api/admin/auth", "10.0.0.2")).status).toBe(200);
    }
    expect(middleware(req("POST", "/api/admin/auth", "10.0.0.2")).status).toBe(429);
  });

  it("POST /api/order: burst max(10)+1 -> 429", () => {
    for (let i = 0; i < 10; i++) {
      expect(middleware(req("POST", "/api/order", "10.0.0.3")).status).toBe(200);
    }
    expect(middleware(req("POST", "/api/order", "10.0.0.3")).status).toBe(429);
  });

  it("GET /api/slug-check: burst max(20)+1 -> 429", () => {
    for (let i = 0; i < 20; i++) {
      expect(middleware(req("GET", "/api/slug-check", "10.0.0.4")).status).toBe(200);
    }
    expect(middleware(req("GET", "/api/slug-check", "10.0.0.4")).status).toBe(429);
  });

  it("after window+1s elapses, the same IP is accepted again", () => {
    for (let i = 0; i < 4; i++) {
      middleware(req("POST", "/api/register", "10.0.0.5"));
    }
    expect(middleware(req("POST", "/api/register", "10.0.0.5")).status).toBe(429);

    vi.advanceTimersByTime(60_000 + 1_000);
    const res = middleware(req("POST", "/api/register", "10.0.0.5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("2");
  });

  it("different IPs get independent windows", () => {
    for (let i = 0; i < 4; i++) {
      middleware(req("POST", "/api/register", "10.0.0.6"));
    }
    expect(middleware(req("POST", "/api/register", "10.0.0.6")).status).toBe(429);
    // Different IP, same route — unaffected.
    expect(middleware(req("POST", "/api/register", "10.0.0.7")).status).toBe(200);
  });

  it("X-RateLimit-Reset is a future epoch seconds value", () => {
    const res = middleware(req("POST", "/api/order", "10.0.0.8"));
    const reset = Number(res.headers.get("X-RateLimit-Reset"));
    expect(reset).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("expired entries are cleaned up by the interval", () => {
    for (let i = 0; i < 3; i++) {
      middleware(req("POST", "/api/register", "10.0.0.9"));
    }
    middleware(req("POST", "/api/order", "10.0.0.10"));
    expect(_rateLimitStoreSize()).toBe(2);

    // Advance past both windows (10s order window), then sweep manually.
    vi.advanceTimersByTime(120_000);
    _sweepExpired();
    expect(_rateLimitStoreSize()).toBe(0);
  });
});

describe("middleware — unlimited routes pass through", () => {
  beforeEach(() => {
    _resetRateLimitsForTest();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("unlisted API route is not rate limited, no rate-limit headers", () => {
    for (let i = 0; i < 50; i++) {
      const res = middleware(req("GET", "/api/tenant/whatever", "10.0.0.11"));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Remaining")).toBeNull();
    }
  });

  it("non-API route outside matcher is untouched", () => {
    const res = middleware(req("GET", "/", "10.0.0.12"));
    expect(res.status).toBe(200);
  });
});

describe("checkRateLimit — unit", () => {
  beforeEach(() => _resetRateLimitsForTest());

  it("returns ok until max, then blocks with remaining 0", () => {
    const cfg = { windowMs: 10_000, max: 2 };
    expect(checkRateLimit("ip-a", "POST /api/x", cfg).ok).toBe(true);
    expect(checkRateLimit("ip-a", "POST /api/x", cfg).ok).toBe(true);
    const blocked = checkRateLimit("ip-a", "POST /api/x", cfg);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("unconfigured route key is never limited", () => {
    const res = checkRateLimit("ip-b", "GET /api/anything-else");
    expect(res.ok).toBe(true);
    expect(res.remaining).toBe(Infinity);
  });

  it("different IPs are independent at the unit level", () => {
    const cfg = { windowMs: 10_000, max: 1 };
    expect(checkRateLimit("ip-c", "POST /api/x", cfg).ok).toBe(true);
    expect(checkRateLimit("ip-c", "POST /api/x", cfg).ok).toBe(false);
    expect(checkRateLimit("ip-d", "POST /api/x", cfg).ok).toBe(true);
  });

  it("count resets after windowMs passes", () => {
    vi.useFakeTimers();
    const cfg = { windowMs: 10_000, max: 1 };
    expect(checkRateLimit("ip-e", "POST /api/x", cfg).ok).toBe(true);
    expect(checkRateLimit("ip-e", "POST /api/x", cfg).ok).toBe(false);
    vi.advanceTimersByTime(11_000);
    expect(checkRateLimit("ip-e", "POST /api/x", cfg).ok).toBe(true);
    vi.useRealTimers();
  });
});
