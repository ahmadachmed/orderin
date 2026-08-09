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

  // Reset menu items for idempotency. Orders referencing them must go first
  // (no FK cascade in the schema — OrderItem/OrderStatusLog have no onDelete).
  const orders = await prisma.order.findMany({
    where: { tenantId: tenant.id },
    select: { id: true },
  });
  for (const o of orders) {
    await prisma.orderStatusLog.deleteMany({ where: { orderId: o.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
  }
  if (orders.length > 0) {
    await prisma.order.deleteMany({ where: { tenantId: tenant.id } });
  }
  await prisma.menuItem.deleteMany({ where: { tenantId: tenant.id } });

  const menu = [
    { name: "Espresso", description: "Single-origin espresso shot", price: 18000, prepTimeSeconds: 90, sortOrder: 1, category: "Minuman" },
    { name: "Kopi Susu Gula Aren", description: "Iced milk coffee with palm sugar", price: 22000, prepTimeSeconds: 150, sortOrder: 2, category: "Minuman" },
    { name: "Cappuccino", description: "Espresso with steamed milk foam", price: 25000, prepTimeSeconds: 120, sortOrder: 3, category: "Minuman" },
    { name: "Americano", description: "Espresso topped with hot water", price: 20000, prepTimeSeconds: 90, sortOrder: 4, category: "Minuman" },
    { name: "Matcha Latte", description: "Iced matcha latte with oat milk", price: 24000, prepTimeSeconds: 150, sortOrder: 5, category: "Minuman" },
    { name: "Pisang Goreng", description: "Crispy fried banana with chocolate drizzle", price: 15000, prepTimeSeconds: 300, sortOrder: 6, category: "Camilan" },
    { name: "Roti Bakar", description: "Grilled toast with butter and sugar", price: 12000, prepTimeSeconds: 240, sortOrder: 7, category: "Camilan" },
    { name: "Nasi Kuning", description: "Turmeric rice with fried egg and sambal", price: 20000, prepTimeSeconds: 480, sortOrder: 8, category: "Makanan" },
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
