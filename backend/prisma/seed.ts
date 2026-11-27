import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const packages = [
  { name: "1 Hour", durationMinutes: 60, priceKes: 10, active: true },
  { name: "6 Hours", durationMinutes: 360, priceKes: 20, active: true },
  { name: "24 Hours", durationMinutes: 1440, priceKes: 50, active: true },
  { name: "7 Days", durationMinutes: 10080, priceKes: 250, active: true },
  { name: "30 Days", durationMinutes: 43200, priceKes: 700, active: true },
];

async function main() {
  for (const item of packages) {
    await prisma.package.upsert({
      where: { name: item.name },
      update: {
        durationMinutes: item.durationMinutes,
        priceKes: item.priceKes,
        active: item.active,
      },
      create: item,
    });
  }

  console.log(`Seeded ${packages.length} GENZ WIFI packages.`);
}

main()
  .catch((error) => {
    console.error("Failed to seed GENZ WIFI packages:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
