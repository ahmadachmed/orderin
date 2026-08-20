// @vitest-environment node
/**
 * Sprint history retention differential — T11 (issue #229).
 *
 * FREE tenants retain sprint history for 1 day, PRO for 30 days — driven
 * by getLimit(plan, 'sprintRetentionDays') from lib/plan.ts (T6), never
 * hardcoded. Integration tests against a live Postgres with a mocked
 * admin session cookie:
 *   GET /api/admin/sprints            → list hides expired closed sprints
 *   GET /api/admin/sprints/[sprintId] → detail 404s for expired history
 * plus pure unit tests for the cutoff helpers in src/lib/sprint.ts.
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "../src/lib/auth";
import { GET as listSprints } from "../src/app/api/admin/sprints/route";
import { GET as getSprintDetail } from "../src/app/api/admin/sprints/[sprintId]/route";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";
import { getSprintRetentionCutoff, isSprintRetained } from "@/lib/sprint";
import { Plan } from "@/lib/plan";
import { SprintStatus } from "@/generated/prisma/enums";

// Mock next/headers so getSession() reads our admin token.
const { tokenStore } = vi.hoisted(() => ({ tokenStore: { current: null as string | null } }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "headwaybrew_admin_session" && tokenStore.current
        ? { value: tokenStore.current }
        : undefined,
  }),
}));

const fixtures: TenantFixture[] = [];

/** now minus N days (plus optional extra hours). */
function daysAgo(days: number, extraHours = 0): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - extraHours * 60 * 60 * 1000);
}

/** Closed sprint that ended at `endedAt` (startAt 1h earlier). */
async function createClosedSprint(tenantId: string, endedAt: Date) {
  return prisma.sprint.create({
    data: {
      tenantId,
      startAt: new Date(endedAt.getTime() - 60 * 60 * 1000),
      status: "CLOSED" as never,
      endAt: endedAt,
      closedAt: endedAt,
    },
  });
}

async function setPlan(tenantId: string, plan: Plan) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { plan } });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

// ── Pure helpers (no DB) ──────────────────────────────────────────────

describe("getSprintRetentionCutoff (pure)", () => {
  it("FREE → cutoff 1 day back", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    const cutoff = getSprintRetentionCutoff(Plan.FREE, now);
    expect(cutoff.getTime()).toBe(now.getTime() - 24 * 60 * 60 * 1000);
  });

  it("PRO → cutoff 30 days back", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    const cutoff = getSprintRetentionCutoff(Plan.PRO, now);
    expect(cutoff.getTime()).toBe(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  });
});

describe("isSprintRetained (pure)", () => {
  // Real now — daysAgo() below is relative to Date.now(), so a hardcoded
  // base date here would drift as real time passes (issue #252 test fix).
  const now = new Date();
  const cutoff = getSprintRetentionCutoff(Plan.FREE, now); // now - 1d

  it("OPEN sprint is always retained, however old", () => {
    expect(
      isSprintRetained(
        { status: SprintStatus.OPEN, startAt: daysAgo(60), endAt: null, closedAt: null },
        cutoff
      )
    ).toBe(true);
  });

  it("CLOSED sprint ended inside the window → retained", () => {
    expect(
      isSprintRetained(
        { status: SprintStatus.CLOSED, startAt: daysAgo(2), endAt: daysAgo(0.1), closedAt: daysAgo(0.1) },
        cutoff
      )
    ).toBe(true);
  });

  it("CLOSED sprint ended before the cutoff → expired", () => {
    expect(
      isSprintRetained(
        { status: SprintStatus.CLOSED, startAt: daysAgo(3), endAt: daysAgo(2), closedAt: daysAgo(2) },
        cutoff
      )
    ).toBe(false);
  });
});

// ── GET /api/admin/sprints — FREE tenant (1 day) ──────────────────────

describe("GET /api/admin/sprints — FREE retention (1 day)", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant(); // plan defaults to FREE
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("keeps a closed sprint ended 2h ago", async () => {
    const sprint = await createClosedSprint(fx.tenantId, daysAgo(0, 2));
    const res = await listSprints();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.sprints as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(sprint.id);
  });

  it("hides a closed sprint ended 2 days ago", async () => {
    const sprint = await createClosedSprint(fx.tenantId, daysAgo(2));
    const res = await listSprints();
    const body = await res.json();
    const ids = (body.sprints as { id: string }[]).map((s) => s.id);
    expect(ids).not.toContain(sprint.id);
  });

  it("always keeps the OPEN sprint even when it started long ago", async () => {
    const sprint = await prisma.sprint.create({
      data: { tenantId: fx.tenantId, startAt: daysAgo(10), status: "OPEN" as never },
    });
    const res = await listSprints();
    const body = await res.json();
    const ids = (body.sprints as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(sprint.id);
  });
});

// ── GET /api/admin/sprints — PRO tenant (30 days) ─────────────────────

describe("GET /api/admin/sprints — PRO retention (30 days)", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    await setPlan(fx.tenantId, Plan.PRO);
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("keeps a closed sprint ended 5 days ago", async () => {
    const sprint = await createClosedSprint(fx.tenantId, daysAgo(5));
    const res = await listSprints();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.sprints as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(sprint.id);
  });

  it("hides a closed sprint ended 31 days ago", async () => {
    const sprint = await createClosedSprint(fx.tenantId, daysAgo(31));
    const res = await listSprints();
    const body = await res.json();
    const ids = (body.sprints as { id: string }[]).map((s) => s.id);
    expect(ids).not.toContain(sprint.id);
  });
});

// ── GET /api/admin/sprints/[sprintId] — retention 404 ─────────────────

describe("GET /api/admin/sprints/[sprintId] — retention", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("FREE: 200 for a closed sprint ended 2h ago", async () => {
    const sprint = await createClosedSprint(fx.tenantId, daysAgo(0, 2));
    const res = await getSprintDetail(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ sprintId: sprint.id }),
    });
    expect(res.status).toBe(200);
  });

  it("FREE: 404 for a closed sprint ended 2 days ago (expired history)", async () => {
    const sprint = await createClosedSprint(fx.tenantId, daysAgo(2));
    const res = await getSprintDetail(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ sprintId: sprint.id }),
    });
    expect(res.status).toBe(404);
  });

  it("PRO: 200 for a closed sprint ended 5 days ago", async () => {
    await setPlan(fx.tenantId, Plan.PRO);
    const sprint = await createClosedSprint(fx.tenantId, daysAgo(5));
    const res = await getSprintDetail(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ sprintId: sprint.id }),
    });
    expect(res.status).toBe(200);
  });

  it("PRO: 404 for a closed sprint ended 31 days ago", async () => {
    const sprint = await createClosedSprint(fx.tenantId, daysAgo(31));
    const res = await getSprintDetail(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ sprintId: sprint.id }),
    });
    expect(res.status).toBe(404);
  });

  it("OPEN sprint started 10 days ago → still 200 for FREE", async () => {
    await setPlan(fx.tenantId, Plan.FREE);
    const sprint = await prisma.sprint.create({
      data: { tenantId: fx.tenantId, startAt: daysAgo(10), status: "OPEN" as never },
    });
    const res = await getSprintDetail(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ sprintId: sprint.id }),
    });
    expect(res.status).toBe(200);
  });
});
