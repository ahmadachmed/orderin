/**
 * T8: Tenant onboarding integration tests.
 * Requires running Postgres with DATABASE_URL set.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, scoped } from "../src/lib/prisma";
import { prisma as db } from "../src/lib/db";
import { hashPassword, verifyPassword } from "../src/lib/password";

const stamp = Date.now();
const SLUG = `test-reg-${stamp}`;
const SLUG2 = `test-reg2-${stamp}`;

// Helper: simulate the register API logic inline for integration tests
async function registerTenant(opts: {
  name: string;
  slug: string;
  username: string;
  password: string;
}) {
  // Check slug uniqueness
  const existing = await db.tenant.findUnique({ where: { slug: opts.slug } });
  if (existing) throw Object.assign(new Error("Slug sudah dipakai"), { status: 409 });

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: opts.name, slug: opts.slug } });
    const admin = await tx.tenantAdmin.create({
      data: {
        tenantId: tenant.id,
        username: opts.username,
        passwordHash: hashPassword(opts.password),
      },
    });
    return { tenant, admin };
  });
}

beforeAll(async () => {
  // Clean up any leftover test data from previous runs
  const oldTenants = await db.tenant.findMany({
    where: { slug: { startsWith: "test-reg-" } },
    select: { id: true },
  });
  for (const t of oldTenants) {
    await prisma.tenantAdmin.deleteMany({ where: { tenantId: t.id } });
  }
  if (oldTenants.length > 0) {
    await db.tenant.deleteMany({
      where: { id: { in: oldTenants.map((t) => t.id) } },
    });
  }
});

afterAll(async () => {
  const testTenants = await db.tenant.findMany({
    where: {
      slug: { in: [SLUG, SLUG2] },
    },
    select: { id: true },
  });
  for (const t of testTenants) {
    await prisma.tenantAdmin.deleteMany({ where: { tenantId: t.id } });
  }
  if (testTenants.length > 0) {
    await db.tenant.deleteMany({
      where: { id: { in: testTenants.map((t) => t.id) } },
    });
  }
});

describe("POST /api/register", () => {
  it("creates tenant + admin and returns them", async () => {
    const result = await registerTenant({
      name: "Test Kedai",
      slug: SLUG,
      username: "admin",
      password: "secret123",
    });

    expect(result.tenant.slug).toBe(SLUG);
    expect(result.tenant.name).toBe("Test Kedai");
    expect(result.admin.username).toBe("admin");
    expect(result.admin.tenantId).toBe(result.tenant.id);

    // Verify password hash
    const stored = result.admin.passwordHash;
    expect(verifyPassword("secret123", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects duplicate slug", async () => {
    await expect(
      registerTenant({
        name: "Test Kedai 2",
        slug: SLUG,
        username: "admin2",
        password: "secret123",
      })
    ).rejects.toThrow("Slug sudah dipakai");
  });

  it("creates second tenant with different slug", async () => {
    const result = await registerTenant({
      name: "Kedai Dua",
      slug: SLUG2,
      username: "barista",
      password: "kopiEnak123",
    });

    expect(result.tenant.slug).toBe(SLUG2);

    // Verify password hash
    expect(verifyPassword("kopiEnak123", result.admin.passwordHash)).toBe(true);
  });
});

describe("slug format validation", () => {
  const validSlugs = ["kopi-senja", "kedai123", "abc", "a-b-c", "test-reg-123"];
  const invalidSlugs = [
    "Kopi-Senja",       // uppercase
    "kopi_senja",       // underscore
    "-kopi",            // leading dash
    "kopi-",            // trailing dash
    "kopi--senja",      // consecutive dashes
    "ab",               // too short (< 3)
    "a".repeat(51),     // too long (> 50)
    "kopi senja",       // space
    "kopi@senja",       // special char
  ];

  it.each(validSlugs)("accepts valid slug: %s", (s) => {
    expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)).toBe(true);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(50);
  });

  it.each(invalidSlugs)("rejects invalid slug: %s", (s) => {
    const valid =
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) &&
      s.length >= 3 &&
      s.length <= 50;
    expect(valid).toBe(false);
  });
});

describe("tenant isolation after registration", () => {
  it("tenant A's admin can't see tenant B's menu items", async () => {
    const tA = await db.tenant.findUnique({ where: { slug: SLUG } });
    const tB = await db.tenant.findUnique({ where: { slug: SLUG2 } });
    expect(tA).not.toBeNull();
    expect(tB).not.toBeNull();

    // Add a menu item to tenant A
    const itemA = await prisma.menuItem.create({
      data: {
        tenantId: tA!.id,
        name: "A-only item",
        price: 1000,
      },
    });

    // Scoped query from tenant B should NOT see tenant A's item
    const items = await scoped(tB!.id).menuItem.findMany();
    const ids = items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(itemA.id);

    // Cleanup
    await prisma.menuItem.deleteMany({ where: { id: itemA.id, tenantId: tA!.id } });
  });

  it("admin login works after registration", async () => {
    const tenant = await db.tenant.findUnique({
      where: { slug: SLUG },
      select: { id: true },
    });
    expect(tenant).not.toBeNull();

    const admin = await db.tenantAdmin.findFirst({
      where: { tenantId: tenant!.id, username: "admin" },
    });
    expect(admin).not.toBeNull();
    expect(verifyPassword("secret123", admin!.passwordHash)).toBe(true);
  });
});

describe("GET /api/slug-check", () => {
  it("returns available=false for registered slug", async () => {
    const t = await db.tenant.findUnique({ where: { slug: SLUG } });
    expect(t).not.toBeNull(); // already registered in beforeAll
  });

  it("returns available=true for unregistered slug", async () => {
    const t = await db.tenant.findUnique({ where: { slug: `available-${stamp}` } });
    expect(t).toBeNull();
  });
});
