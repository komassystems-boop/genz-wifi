import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const plans = [
    { name: "1 Hour", durationMinutes: 60, priceKes: 10 },
    { name: "6 Hours", durationMinutes: 360, priceKes: 20 },
    { name: "24 Hours", durationMinutes: 1440, priceKes: 50 },
    { name: "7 Days", durationMinutes: 10080, priceKes: 250 },
    { name: "30 Days", durationMinutes: 43200, priceKes: 700 }
  ];
  for (const plan of plans) await prisma.package.upsert({ where: { name: plan.name }, update: plan, create: plan });
}
main().finally(() => prisma.$disconnect());
