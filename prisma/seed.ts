/**
 * Seed script — demo tenant + sample menu.
 * Run: npm run db:seed  (tsx prisma/seed.ts)
 * Idempotent: upserts tenant by slug, resets its menu items.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "kopi-senja" },
    update: {},
    create: {
      slug: "kopi-senja",
      name: "Kopi Senja Makassar",
      address: "Jl. Somba Opu No. 12, Makassar",
      phone: "081234567890",
      // HH:mm UTC — tenant converts from local time (Asia/Makassar, UTC+8) when setting
      openTime: "07:00",
      closeTime: "21:00",
      timezone: "Asia/Makassar",
      maxQueueSize: 20,
    },
  });

  // Reset menu items for idempotency
  await prisma.menuItem.deleteMany({ where: { tenantId: tenant.id } });

  const menu = [
    { name: "Espresso", description: "Single-origin espresso shot", price: 18000, prepTimeSeconds: 90, sortOrder: 1 },
    { name: "Kopi Susu Gula Aren", description: "Iced milk coffee with palm sugar", price: 22000, prepTimeSeconds: 150, sortOrder: 2 },
    { name: "Cappuccino", description: "Espresso with steamed milk foam", price: 25000, prepTimeSeconds: 120, sortOrder: 3 },
    { name: "Americano", description: "Espresso topped with hot water", price: 20000, prepTimeSeconds: 90, sortOrder: 4 },
    { name: "Matcha Latte", description: "Iced matcha latte with oat milk", price: 24000, prepTimeSeconds: 150, sortOrder: 5 },
  ];

  for (const item of menu) {
    await prisma.menuItem.create({ data: { ...item, tenantId: tenant.id } });
  }

  // Demo admin for the dashboard (MVP: username + password, PLAN §3.3/§9.2).
  await prisma.tenantAdmin.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: "admin" } },
    update: {},
    create: {
      tenantId: tenant.id,
      username: "admin",
      passwordHash: hashPassword("admin123"),
    },
  });

  console.log(`Seeded tenant "${tenant.slug}" with ${menu.length} menu items.`);
  console.log(`Seeded admin  "admin" / password "admin123" for tenant "${tenant.slug}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
