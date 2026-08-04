/**
 * LOGIN-05 + LOGIN-01 + REG-10 — admin session probe / logout / redirect.
 *   - GET    /api/admin/auth → 200 {authenticated:true} | 401 (LOGIN-01)
 *   - DELETE /api/admin/auth → 204 + cleared cookie (LOGIN-05)
 *   - adminDashboardPath()   → dashboard route contract (REG-10)
 *   - probeAdminSession()    → client helper used by the login page (LOGIN-01)
 * No DB writes: GET/DELETE handlers are cookie-only.
 */
import "dotenv/config";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createSession } from "../src/lib/auth";
import { GET, DELETE } from "../src/app/api/admin/auth/route";
import { adminDashboardPath, probeAdminSession } from "../src/lib/admin-api";

// Mock next/headers so getSession() reads our token store.
const { tokenStore } = vi.hoisted(() => ({ tokenStore: { current: null as string | null } }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "orderin_admin_session" && tokenStore.current
        ? { value: tokenStore.current }
        : undefined,
  }),
}));

afterEach(() => {
  tokenStore.current = null;
  vi.unstubAllGlobals();
});

describe("LOGIN-01 — GET /api/admin/auth session probe", () => {
  it("returns 401 when no session cookie is present", async () => {
    tokenStore.current = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 200 {authenticated:true} for a valid session", async () => {
    tokenStore.current = createSession("tenant-1", "admin-1");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true });
  });

  it("returns 401 for a tampered token", async () => {
    const token = createSession("tenant-1", "admin-1");
    const [payload] = token.split(".");
    tokenStore.current = `${payload}.AAAA`;
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("LOGIN-05 — DELETE /api/admin/auth logout", () => {
  it("returns 204 No Content", async () => {
    const res = await DELETE();
    expect(res.status).toBe(204);
  });

  it("clears the session cookie (Max-Age=0)", async () => {
    const res = await DELETE();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("orderin_admin_session=;");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Path=/");
  });
});

describe("REG-10 — adminDashboardPath redirect contract", () => {
  it("builds the dashboard path from the tenant slug", () => {
    expect(adminDashboardPath("kopi-senja")).toBe("/admin/kopi-senja");
    expect(adminDashboardPath("a-b-c")).toBe("/admin/a-b-c");
  });
});

describe("LOGIN-01 — probeAdminSession client helper", () => {
  it("returns true when the probe responds ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await expect(probeAdminSession()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/admin/auth", { credentials: "include" });
  });

  it("returns false on 401 (session invalid)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(probeAdminSession()).resolves.toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(probeAdminSession()).resolves.toBe(false);
  });
});
