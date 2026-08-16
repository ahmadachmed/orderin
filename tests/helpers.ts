/**
 * Shared fixtures for the critical-path integration tests (issue #8).
 * Uses the plain client (lib/db) for setup/cleanup so the tenant-scoping
 * extension under test is never bypassed by fixture code.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export interface TenantFixture {
  tenantId: string;
  slug: string;
  adminId: string;
  itemAvailable: string; // prep 600s, price 15000
  itemUnavailable: string; // isAvailable: false, prep 300s
}

export interface TenantOptions {
  isOpen?: boolean;
  isOpenOverrideUntil?: Date | string | null; // #207 v2 — time-boxed toggle override
  openTime?: string;
  closeTime?: string;
  maxQueueSize?: number;
  prepTimeBuffer?: number; // minutes
  sprintDurationDays?: number; // T15 §5.4 — sprint retention period
}

export async function setupTenant(opts: TenantOptions = {}): Promise<TenantFixture> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `t7-${stamp}`;
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: "T7 Test Shop",
      isOpen: opts.isOpen ?? true,
      isOpenOverrideUntil: opts.isOpenOverrideUntil ?? null,
      openTime: opts.openTime ?? "00:00",
      closeTime: opts.closeTime ?? "23:59",
      maxQueueSize: opts.maxQueueSize ?? 20,
      prepTimeBuffer: opts.prepTimeBuffer ?? 5,
      sprintDurationDays: opts.sprintDurationDays ?? 1, // T15 §5.4
      // T2: explicitly set plan fields (defaults exist, but be explicit)
      plan: "FREE",
      isActive: true,
    },
  });
  const admin = await prisma.tenantAdmin.create({
    data: { tenantId: tenant.id, username: `admin-${stamp}`, passwordHash: await hashPassword("secret") },
  });
  const available = await prisma.menuItem.create({
    data: { tenantId: tenant.id, name: "Item A", price: 15000, prepTimeSeconds: 600, isAvailable: true },
  });
  const unavailable = await prisma.menuItem.create({
    data: { tenantId: tenant.id, name: "Item B", price: 20000, prepTimeSeconds: 300, isAvailable: false },
  });
  return {
    tenantId: tenant.id,
    slug,
    adminId: admin.id,
    itemAvailable: available.id,
    itemUnavailable: unavailable.id,
  };
}

/** Delete every row belonging to the fixture tenant (children first — no FK cascade). */
export async function cleanupTenant(tenantId: string): Promise<void> {
  // Bulk-delete children via the to-one relation filter instead of looping
  // per order — cap tests seed 300+ orders, so the loop was 600+ sequential
  // queries per fixture and blew vitest's hookTimeout (10s default).
  await prisma.orderStatusLog.deleteMany({ where: { order: { tenantId } } });
  await prisma.orderItem.deleteMany({ where: { order: { tenantId } } });
  await prisma.order.deleteMany({ where: { tenantId } });
  await prisma.menuItem.deleteMany({ where: { tenantId } });
  await prisma.tenantAdmin.deleteMany({ where: { tenantId } });
  // T15 §5.4: POST /api/order auto-creates an OPEN sprint — delete sprints
  // before the tenant (FK ON DELETE RESTRICT).
  await prisma.sprint.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

/** Create an order directly in the DB (bypasses POST — for transition/payment tests). */
export async function createOrderDirect(tenantId: string, itemId: string, opts: { status?: string; paymentStatus?: string } = {}) {
  return prisma.order.create({
    data: {
      tenantId,
      customerName: "Direct Customer",
      customerPhone: "081299887766",
      status: opts.status as never,
      paymentStatus: opts.paymentStatus as never,
      items: { create: [{ menuItemId: itemId, quantity: 1, unitPrice: 15000 }] },
    },
  });
}
