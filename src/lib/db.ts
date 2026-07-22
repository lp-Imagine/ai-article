import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/** 热更新后可能仍缓存旧 Client（无 User/Session 模型） */
function isClientCurrent(client: PrismaClient | undefined): boolean {
  const user = (client as unknown as { user?: { findFirst?: unknown } } | undefined)?.user;
  return typeof user?.findFirst === "function";
}

const existing = globalForPrisma.prisma;
if (existing && !isClientCurrent(existing)) {
  void existing.$disconnect().catch(() => {});
  globalForPrisma.prisma = undefined;
}

export const db: PrismaClient = isClientCurrent(globalForPrisma.prisma)
  ? globalForPrisma.prisma!
  : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
