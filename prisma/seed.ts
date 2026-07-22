import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const username = (process.env.SUPER_ADMIN_USERNAME || "admin").trim();
  const password = process.env.SUPER_ADMIN_PASSWORD || "admin123";

  const passwordHash = hashPassword(password);

  const existing = await prisma.user.findUnique({ where: { username } });
  const shouldResetPassword =
    !existing ||
    existing.passwordHash.startsWith("00000000") ||
    process.env.SUPER_ADMIN_RESET === "1";

  const admin = await prisma.user.upsert({
    where: { username },
    create: {
      username,
      passwordHash,
      displayName: "超级管理员",
      role: "SUPER_ADMIN",
    },
    update: {
      role: "SUPER_ADMIN",
      disabled: false,
      ...(shouldResetPassword ? { passwordHash } : {}),
    },
  });

  await prisma.appConfig.upsert({
    where: {
      userId_configKey: { userId: admin.id, configKey: "defaultStyle" },
    },
    create: {
      userId: admin.id,
      configKey: "defaultStyle",
      configValue: "干货型",
    },
    update: { configValue: "干货型" },
  });

  await prisma.appConfig.upsert({
    where: {
      userId_configKey: { userId: admin.id, configKey: "defaultWordCount" },
    },
    create: {
      userId: admin.id,
      configKey: "defaultWordCount",
      configValue: "1200",
    },
    update: { configValue: "1200" },
  });

  console.log("Seed completed", {
    admin: admin.username,
    // fingerprint only — avoid logging secrets
    passwordSet: createHash("sha256").update(password).digest("hex").slice(0, 8),
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
