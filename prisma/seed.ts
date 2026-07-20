import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.appConfig.upsert({
    where: { configKey: "defaultStyle" },
    create: { configKey: "defaultStyle", configValue: "干货型" },
    update: { configValue: "干货型" },
  });

  await prisma.appConfig.upsert({
    where: { configKey: "defaultWordCount" },
    create: { configKey: "defaultWordCount", configValue: "1200" },
    update: { configValue: "1200" },
  });

  console.log("Seed completed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });