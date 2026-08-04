/**
 * SEC-05: SESSION_SECRET fail-fast guard (src/lib/auth.ts).
 * Unit tests — no DB needed.
 *   - Module import must THROW when NODE_ENV=production and SESSION_SECRET is
 *     missing or still the dev default.
 *   - verifySession keeps working with a valid secret (non-prod / prod valid).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock next/headers so auth.ts imports cleanly in a node test env.
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Fresh module instance: vi.resetModules() in afterEach re-evaluates on import. */
function freshAuth() {
  return import("../src/lib/auth");
}

describe("SEC-05 — fail-fast SESSION_SECRET in production", () => {
  it("throws on import when NODE_ENV=production and SESSION_SECRET is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.SESSION_SECRET;
    await expect(freshAuth()).rejects.toThrow(/SESSION_SECRET/);
  });

  it("throws on import when SESSION_SECRET is still the dev default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "orderin-dev-insecure-secret-change-me");
    await expect(freshAuth()).rejects.toThrow(/SESSION_SECRET/);
  });

  it("does NOT throw in non-production when SESSION_SECRET is unset (dev default ok)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.SESSION_SECRET;
    const mod = await freshAuth();
    expect(mod).toBeTruthy();
  });

  it("does NOT throw in production when a real SESSION_SECRET is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "a-real-long-random-secret-42");
    const mod = await freshAuth();
    expect(mod).toBeTruthy();
  });
});

describe("SEC-05 — verifySession still works with a valid secret", () => {
  it("signs and verifies a session with a valid production secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "a-real-long-random-secret-42");
    const { createSession, verifySession } = await freshAuth();
    const token = createSession("tenant-1", "admin-1");
    expect(verifySession(token)).toEqual({ tenantId: "tenant-1", adminId: "admin-1" });
  });

  it("signs and verifies a session with the dev default in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", "orderin-dev-insecure-secret-change-me");
    const { createSession, verifySession } = await freshAuth();
    const token = createSession("tenant-2", "admin-2");
    expect(verifySession(token)).toEqual({ tenantId: "tenant-2", adminId: "admin-2" });
  });

  it("rejects tampered tokens", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", "orderin-dev-insecure-secret-change-me");
    const { createSession, verifySession } = await freshAuth();
    const token = createSession("tenant-3", "admin-3");
    const [payload] = token.split(".");
    expect(verifySession(`${payload}.AAAA`)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });
});
