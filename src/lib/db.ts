/**
 * Plain Prisma client singleton for PUBLIC (customer-facing) server reads.
 *
 * T3 only — deliberately separate from lib/prisma.ts (owned by T2, adds the
 * mandatory tenant-scoping extension). Public pages look up a tenant by slug
 * and an order by unguessable UUID — both intentionally unscoped lookups,
 * so no tenant context is needed here.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
