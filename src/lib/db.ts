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

function isBuildPhase() {
  // next build 收集页面数据时会 import 本模块，此时不一定有真实 DATABASE_URL
  return (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build"
  );
}

function assertDatabaseUrl() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    if (isBuildPhase()) return;
    throw new Error(
      "DATABASE_URL 未设置。请配置 postgresql://draftly:draftly@localhost:5432/draftly",
    );
  }
  if (url.startsWith("file:")) {
    throw new Error(
      "项目已改用 PostgreSQL，不能再用 SQLite（file:...）。" +
        "请把 .env / .env.local 改成 postgresql://…，然后 migrate + generate 并重启。",
    );
  }
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    if (isBuildPhase()) return;
    throw new Error(
      `DATABASE_URL 必须以 postgresql:// 开头（当前：${url.slice(0, 24)}…）`,
    );
  }
}

const existing = globalForPrisma.prisma;
if (existing && !isClientCurrent(existing)) {
  void existing.$disconnect().catch(() => {});
  globalForPrisma.prisma = undefined;
}

function getDb(): PrismaClient {
  assertDatabaseUrl();
  if (isClientCurrent(globalForPrisma.prisma)) {
    return globalForPrisma.prisma!;
  }
  // 构建阶段无真实库时，用占位 URL 让 Prisma Client 能实例化（不会真正连库）
  if (!process.env.DATABASE_URL && isBuildPhase()) {
    process.env.DATABASE_URL =
      "postgresql://build:build@127.0.0.1:5432/build?schema=public";
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

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getDb();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
