import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const p = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const t = await p.tenant.findUnique({
    where: { slug: "kopi-senja" },
    include: {
      menuItems: { select: { name: true, price: true, isAvailable: true } },
      admins: { select: { username: true } },
    },
  });
  if (!t) {
    console.log("TENANT MISSING");
    process.exit(1);
  }
  console.log("tenant:", t.name);
  console.log(
    "open:",
    t.isOpen,
    "| hours:",
    t.openTime,
    "-",
    t.closeTime,
    "UTC | maxQueue:",
    t.maxQueueSize,
    "| buffer:",
    t.prepTimeBuffer,
    "min"
  );
  console.log("menu items:", t.menuItems.length);
  t.menuItems.forEach((m) => console.log(" -", m.name, Number(m.price), "available:", m.isAvailable));
  console.log("admins:", t.admins.map((a) => a.username).join(","));
  await p.$disconnect();
}

main();
