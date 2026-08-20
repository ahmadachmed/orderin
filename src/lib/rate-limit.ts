/**
 * T12 (issue #23): in-memory sliding-window rate limiter.
 * Zero deps — pure Map<string, {count, resetAt}> + interval cleanup.
 *
 * Pure module: no next/server imports, so it works both in the Next.js
 * Edge middleware sandbox and in plain Node (vitest unit tests).
 *
 * Window semantics (per spec): each (route, ip) gets a fresh window on first
 * hit; `count` increments until `resetAt` passes, then the window resets.
 * Expired entries are pruned lazily on read AND by a periodic interval.
 */

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
  remaining: number;
  resetAt: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * Per-route limits, keyed by "METHOD /path".
 * | POST /api/register   | 60s | 3  |
 * | POST /api/admin/auth | 60s | 5  |
 * | POST /api/order      | 10s | 10 |
 * | GET  /api/slug-check | 10s | 20 |
 * | POST /api/order/lookup | 60s | 5 |
 * | POST /api/billing/upgrade | 60s | 5  | (Phase 3 — invoice-spam defense)
 * | POST /api/webhooks/duitku | 60s | 30 | (Phase 3 — defense-in-depth; signature is the authority)
 * | POST /api/cron/rebill     | 60s | 5  | (Phase 3 — defense-in-depth; x-cron-secret is the authority)
 */
export const ROUTE_RATE_LIMITS: Record<string, RateLimitConfig> = {
  "POST /api/register": { windowMs: 60_000, max: 3 },
  "POST /api/admin/auth": { windowMs: 60_000, max: 5 },
  "POST /api/order": { windowMs: 10_000, max: 10 },
  "GET /api/slug-check": { windowMs: 10_000, max: 20 },
  "POST /api/order/lookup": { windowMs: 60_000, max: 5 },
  "POST /api/customer/register": { windowMs: 60_000, max: 3 },
  "POST /api/customer/login": { windowMs: 60_000, max: 10 },
  "POST /api/billing/upgrade": { windowMs: 60_000, max: 5 },
  "POST /api/webhooks/duitku": { windowMs: 60_000, max: 30 },
  "POST /api/cron/rebill": { windowMs: 60_000, max: 5 },
};

const store = new Map<string, Entry>();

/**
 * Check whether a request from `ip` to `routeKey` ("METHOD /path") is allowed.
 * Routes not listed in ROUTE_RATE_LIMITS are never limited.
 */
export function checkRateLimit(
  ip: string,
  routeKey: string,
  config?: RateLimitConfig
): RateLimitResult {
  const cfg = config ?? ROUTE_RATE_LIMITS[routeKey];
  if (!cfg) {
    return { ok: true, retryAfterSec: 0, remaining: Infinity, resetAt: 0 };
  }

  const now = Date.now();
  const key = `${routeKey}|${ip}`;
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + cfg.windowMs });
    return {
      ok: true,
      retryAfterSec: 0,
      remaining: cfg.max - 1,
      resetAt: now + cfg.windowMs,
    };
  }

  entry.count += 1;
  if (entry.count > cfg.max) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  return {
    ok: true,
    retryAfterSec: 0,
    remaining: cfg.max - entry.count,
    resetAt: entry.resetAt,
  };
}

/** Remove entries whose window has expired. Exported for tests. */
export function _sweepExpired(now: number = Date.now()): void {
  store.forEach((entry, key) => {
    if (entry.resetAt <= now) store.delete(key);
  });
}

// Periodic cleanup of expired entries so the store can't grow unbounded.
const CLEANUP_MS = 60_000;
let cleanupStarted = false;
function startCleanup(): void {
  if (cleanupStarted) return;
  cleanupStarted = true;
  try {
    const timer = setInterval(() => _sweepExpired(), CLEANUP_MS);
    // Don't keep the Node process alive just for cleanup (vitest / next dev).
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  } catch {
    // Edge sandbox without setInterval: entries still expire lazily on read.
  }
}
startCleanup();

/** Test-only helpers (not part of the public API surface). */
export function _resetRateLimitsForTest(): void {
  store.clear();
}

export function _rateLimitStoreSize(): number {
  return store.size;
}
