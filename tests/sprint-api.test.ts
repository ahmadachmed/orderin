/**
 * Sprint admin API — T15 (issue #29, PLAN §5.2).
 * Integration tests for the sprint endpoints against a live Postgres with a
 * mocked admin session cookie (same pattern as status-transitions.test.ts):
 *   GET  /api/admin/sprints                 → list + on-the-fly revenue (Σ PAID)
 *   POST /api/admin/sprints                 → open new sprint (auto-close OPEN)
 *   GET  /api/admin/sprints/[sprintId]      → detail + orders + revenue
 *   POST /api/admin/sprints/[sprintId]/close → manual close (404/409)
 */
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "../src/lib/auth";
import {
  GET as listSprints,
  POST as openSprint,
} from "../src/app/api/admin/sprints/route";
import { GET as getSprintDetail } from "../src/app/api/admin/sprints/[sprintId]/route";
import { POST as closeSprintRoute } from "../src/app/api/admin/sprints/[sprintId]/close/route";
import { setupTenant, cleanupTenant, type TenantFixture } from "./helpers";

// Mock next/headers so getSession() reads our admin token.
const { tokenStore } = vi.hoisted(() => ({ tokenStore: { current: null as string | null } }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "orderin_admin_session" && tokenStore.current
        ? { value: tokenStore.current }
        : undefined,
  }),
}));

const fixtures: TenantFixture[] = [];

async function postClose(sprintId: string) {
  return closeSprintRoute(new NextRequest(`http://localhost/api/admin/sprints/${sprintId}/close`, { method: "POST" }), {
    params: { sprintId },
  });
}

afterAll(async () => {
  for (const f of fixtures) await cleanupTenant(f.tenantId);
});

describe("GET /api/admin/sprints", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("returns 401 without a session", async () => {
    tokenStore.current = null;
    const res = await listSprints();
    expect(res.status).toBe(401);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("lists sprints newest-first with orderCount and 0 revenue", async () => {
    const sprint = await prisma.sprint.create({
      data: { tenantId: fx.tenantId, startAt: new Date(), status: "OPEN" as never },
    });
    const res = await listSprints();
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.sprints.find((s: { id: string }) => s.id === sprint.id);
    expect(row).toBeDefined();
    expect(row.status).toBe("OPEN");
    expect(row.orderCount).toBe(0);
    expect(row.revenue).toBe(0);
  });

  it("computes revenue as Σ PAID order totals (UNPAID excluded)", async () => {
    const sprint = await prisma.sprint.create({
      data: { tenantId: fx.tenantId, startAt: new Date(), status: "OPEN" as never },
    });
    // Paid order: 2 × 15000 = 30000. Unpaid order: excluded.
    await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerName: "Paid",
        customerPhone: "0811",
        status: "PICKED_UP" as never,
        paymentStatus: "PAID" as never,
        sprintId: sprint.id,
        items: { create: [{ menuItemId: fx.itemAvailable, quantity: 2, unitPrice: 15000 }] },
      },
    });
    await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerName: "Unpaid",
        customerPhone: "0822",
        status: "PENDING" as never,
        paymentStatus: "UNPAID" as never,
        sprintId: sprint.id,
        items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
      },
    });

    const res = await listSprints();
    const body = await res.json();
    const row = body.sprints.find((s: { id: string }) => s.id === sprint.id);
    expect(row.orderCount).toBe(2);
    expect(row.revenue).toBe(30000);
  });
});

describe("GET /api/admin/sprints/[sprintId]", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("returns 404 for an unknown sprint", async () => {
    const res = await getSprintDetail(new NextRequest("http://localhost/x"), {
      params: { sprintId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("returns sprint detail with orders, items, statusLogs and revenue", async () => {
    const sprint = await prisma.sprint.create({
      data: { tenantId: fx.tenantId, startAt: new Date(), status: "OPEN" as never },
    });
    const order = await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerName: "Detail",
        customerPhone: "0833",
        status: "PENDING" as never,
        paymentStatus: "PAID" as never,
        sprintId: sprint.id,
        items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
        statusLogs: { create: [{ status: "PENDING", note: "created" }] },
      },
      include: { items: true, statusLogs: true },
    });

    const res = await getSprintDetail(new NextRequest("http://localhost/x"), {
      params: { sprintId: sprint.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sprint.id).toBe(sprint.id);
    expect(body.sprint.orderCount).toBe(1);
    expect(body.sprint.revenue).toBe(15000);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].id).toBe(order.id);
    expect(body.orders[0].items[0].quantity).toBe(1);
    expect(Number(body.orders[0].items[0].unitPrice)).toBe(15000);
    expect(body.orders[0].statusLogs[0].status).toBe("PENDING");
  });
});

describe("POST /api/admin/sprints — open new sprint", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("creates a fresh OPEN sprint when none exists (autoClosed: false)", async () => {
    const res = await openSprint();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.autoClosed).toBe(false);
    expect(body.sprint.status).toBe("OPEN");
    expect(body.sprint.tenantId).toBe(fx.tenantId);
  });

  it("auto-closes the existing OPEN sprint and carries orders over", async () => {
    // Open sprint with one PENDING order → opening a new sprint must carry it.
    const existing = await prisma.sprint.findFirst({
      where: { tenantId: fx.tenantId, status: "OPEN" },
    });
    const order = await prisma.order.create({
      data: {
        tenantId: fx.tenantId,
        customerName: "Carry",
        customerPhone: "0844",
        status: "PENDING" as never,
        paymentStatus: "UNPAID" as never,
        sprintId: existing!.id,
        items: { create: [{ menuItemId: fx.itemAvailable, quantity: 1, unitPrice: 15000 }] },
      },
    });

    const res = await openSprint();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.autoClosed).toBe(true);
    expect(body.carriedOver).toBe(1);
    expect(body.sprint.status).toBe("OPEN");
    expect(body.sprint.id).not.toBe(existing!.id);

    const closed = await prisma.sprint.findUnique({ where: { id: existing!.id } });
    expect(closed?.status).toBe("CLOSED");
    const moved = await prisma.order.findUnique({ where: { id: order.id } });
    expect(moved?.sprintId).toBe(body.sprint.id);
  });
});

describe("POST /api/admin/sprints/[sprintId]/close", () => {
  let fx: TenantFixture;
  beforeAll(async () => {
    fx = await setupTenant();
    fixtures.push(fx);
    tokenStore.current = createSession(fx.tenantId, fx.adminId);
  });

  it("returns 404 for a non-existent sprint", async () => {
    const res = await postClose("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });

  it("returns 409 for an already-CLOSED sprint", async () => {
    const sprint = await prisma.sprint.create({
      data: {
        tenantId: fx.tenantId,
        startAt: new Date(),
        status: "CLOSED" as never,
        endAt: new Date(),
        closedAt: new Date(),
      },
    });
    const res = await postClose(sprint.id);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already closed");
  });

  it("closes an OPEN sprint and reports carry-over/archived counts", async () => {
    const sprint = await prisma.sprint.create({
      data: { tenantId: fx.tenantId, startAt: new Date(), status: "OPEN" as never },
    });
    const res = await postClose(sprint.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newSprintId).toBeTruthy();
    expect(body.carriedOver).toBe(0);
    expect(body.archived).toBe(0);

    const closed = await prisma.sprint.findUnique({ where: { id: sprint.id } });
    expect(closed?.status).toBe("CLOSED");
  });
});
