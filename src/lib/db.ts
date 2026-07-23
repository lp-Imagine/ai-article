import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/** 热更新后可能仍缓存旧 Client（缺 User / GenerationJob 等模型） */
function isClientCurrent(client: PrismaClient | undefined): boolean {
  if (!client) return false;
  const c = client as unknown as {
    user?: { findFirst?: unknown };
    generationJob?: { findFirst?: unknown };
  };
  return (
    typeof c.user?.findFirst === "function" &&
    typeof c.generationJob?.findFirst === "function"
  );
}

function assertDatabaseUrl() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    throw new Error(
      "DATABASE_URL 未设置。请在 .env.local 配置 postgresql://draftly:draftly@localhost:5432/draftly",
    );
  }
  if (url.startsWith("file:")) {
    throw new Error(
      "项目已改用 PostgreSQL，不能再用 SQLite（file:...）。" +
        "请把 .env / .env.local 改成 postgresql://draftly:draftly@localhost:5432/draftly，" +
        "然后执行：docker compose up -d db && npx prisma migrate deploy && npx prisma generate，最后重启 npm run dev。",
    );
  }
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    throw new Error(
      `DATABASE_URL 必须以 postgresql:// 开头（当前：${url.slice(0, 24)}…）`,
    );
  }
}

assertDatabaseUrl();

const existing = globalForPrisma.prisma;
if (existing && !isClientCurrent(existing)) {
  void existing.$disconnect().catch(() => {});
  globalForPrisma.prisma = undefined;
}

function getDb(): PrismaClient {
  if (isClientCurrent(globalForPrisma.prisma)) {
    return globalForPrisma.prisma!;
  }
  const client = createPrismaClient();
  if (!isClientCurrent(client)) {
    throw new Error(
      "Prisma Client 缺少 User/GenerationJob。请执行 npx prisma generate 后重启开发服务。",
    );
  }
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const db: PrismaClient = getDb();
