/**
 * 将旧版 SQLite 数据导入 PostgreSQL（一次性）。
 *
 * 用法（在已能连上目标 Postgres、且 migrate deploy 完成后）：
 *
 *   SQLITE_PATH=/www/data/ai-article/prod.db \
 *   DATABASE_URL=postgresql://draftly:draftly@127.0.0.1:5432/draftly \
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * 注意：会清空目标库中的业务表后导入。请先备份。
 */

import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";

const sqlitePath = process.env.SQLITE_PATH;
if (!sqlitePath) {
  console.error("请设置 SQLITE_PATH=.../prod.db");
  process.exit(1);
}

const prisma = new PrismaClient();
const sqlite = new Database(sqlitePath, { readonly: true });

function rows(table: string): Record<string, unknown>[] {
  try {
    return sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
  } catch {
    console.warn(`跳过表 ${table}（不存在）`);
    return [];
  }
}

function bool(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

async function main() {
  console.log("读取 SQLite:", sqlitePath);
  console.log("写入 Postgres:", process.env.DATABASE_URL);

  const users = rows("User");
  const sessions = rows("Session");
  const articles = rows("Article");
  const versions = rows("ArticleVersion");
  const images = rows("ImageAsset");
  const publishes = rows("PublishRecord");
  const risks = rows("RiskCheck");
  const configs = rows("AppConfig");

  console.log("清空目标表…");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "GenerationJob", "AppConfig", "RiskCheck", "PublishRecord", "ImageAsset",
    "ArticleVersion", "Article", "Session", "User"
    RESTART IDENTITY CASCADE`);

  console.log(`导入 User (${users.length})…`);
  for (const u of users) {
    await prisma.user.create({
      data: {
        id: String(u.id),
        username: String(u.username),
        passwordHash: String(u.passwordHash),
        displayName: u.displayName != null ? String(u.displayName) : null,
        role: (u.role as "USER" | "SUPER_ADMIN") || "USER",
        disabled: bool(u.disabled),
        createdAt: new Date(String(u.createdAt)),
        updatedAt: new Date(String(u.updatedAt)),
      },
    });
  }

  console.log(`导入 Session (${sessions.length})…`);
  for (const s of sessions) {
    await prisma.session.create({
      data: {
        id: String(s.id),
        token: String(s.token),
        userId: String(s.userId),
        expiresAt: new Date(String(s.expiresAt)),
        createdAt: new Date(String(s.createdAt)),
      },
    });
  }

  console.log(`导入 Article (${articles.length})…`);
  for (const a of articles) {
    let outline = a.outline;
    if (typeof outline === "string") {
      try {
        outline = JSON.parse(outline);
      } catch {
        outline = null;
      }
    }
    await prisma.article.create({
      data: {
        id: String(a.id),
        userId: String(a.userId),
        topic: String(a.topic),
        keywords: a.keywords != null ? String(a.keywords) : null,
        title: a.title != null ? String(a.title) : null,
        subtitle: a.subtitle != null ? String(a.subtitle) : null,
        summary: a.summary != null ? String(a.summary) : null,
        outline: outline as object | undefined,
        content: a.content != null ? String(a.content) : null,
        style: a.style != null ? String(a.style) : null,
        audience: a.audience != null ? String(a.audience) : null,
        goal: a.goal != null ? String(a.goal) : null,
        wordCount: a.wordCount != null ? Number(a.wordCount) : null,
        outlineCount: a.outlineCount != null ? Number(a.outlineCount) : 3,
        status: (a.status as "draft") || "draft",
        coverImageUrl: a.coverImageUrl != null ? String(a.coverImageUrl) : null,
        selectedOutlineIndex:
          a.selectedOutlineIndex != null ? Number(a.selectedOutlineIndex) : null,
        wechatDraftId: a.wechatDraftId != null ? String(a.wechatDraftId) : null,
        createdAt: new Date(String(a.createdAt)),
        updatedAt: new Date(String(a.updatedAt)),
      },
    });
  }

  console.log(`导入 ArticleVersion (${versions.length})…`);
  for (const v of versions) {
    let outline = v.outline;
    if (typeof outline === "string") {
      try {
        outline = JSON.parse(outline);
      } catch {
        outline = null;
      }
    }
    await prisma.articleVersion.create({
      data: {
        id: String(v.id),
        articleId: String(v.articleId),
        versionType: v.versionType as "outline",
        source: (v.source as "ai") || "ai",
        title: v.title != null ? String(v.title) : null,
        summary: v.summary != null ? String(v.summary) : null,
        outline: outline as object | undefined,
        content: v.content != null ? String(v.content) : null,
        createdAt: new Date(String(v.createdAt)),
      },
    });
  }

  console.log(`导入 ImageAsset (${images.length})…`);
  for (const img of images) {
    await prisma.imageAsset.create({
      data: {
        id: String(img.id),
        articleId: String(img.articleId),
        type: img.type as "cover",
        source: img.source as "ai",
        url: img.url != null ? String(img.url) : null,
        localPath: img.localPath != null ? String(img.localPath) : null,
        prompt: img.prompt != null ? String(img.prompt) : null,
        wechatMediaId: img.wechatMediaId != null ? String(img.wechatMediaId) : null,
        sortOrder: img.sortOrder != null ? Number(img.sortOrder) : 0,
        createdAt: new Date(String(img.createdAt)),
      },
    });
  }

  console.log(`导入 PublishRecord (${publishes.length})…`);
  for (const p of publishes) {
    await prisma.publishRecord.create({
      data: {
        id: String(p.id),
        articleId: String(p.articleId),
        channel: p.channel != null ? String(p.channel) : "wechat",
        status: (p.status as "pending") || "pending",
        requestPayload: p.requestPayload != null ? String(p.requestPayload) : null,
        responsePayload: p.responsePayload != null ? String(p.responsePayload) : null,
        errorMessage: p.errorMessage != null ? String(p.errorMessage) : null,
        createdAt: new Date(String(p.createdAt)),
      },
    });
  }

  console.log(`导入 RiskCheck (${risks.length})…`);
  for (const r of risks) {
    await prisma.riskCheck.create({
      data: {
        id: String(r.id),
        articleId: String(r.articleId),
        score: r.score != null ? Number(r.score) : null,
        issues: r.issues != null ? String(r.issues) : null,
        suggestions: r.suggestions != null ? String(r.suggestions) : null,
        createdAt: new Date(String(r.createdAt)),
      },
    });
  }

  console.log(`导入 AppConfig (${configs.length})…`);
  for (const c of configs) {
    await prisma.appConfig.create({
      data: {
        id: String(c.id),
        userId: String(c.userId),
        configKey: String(c.configKey),
        configValue: String(c.configValue),
        createdAt: new Date(String(c.createdAt)),
        updatedAt: new Date(String(c.updatedAt)),
      },
    });
  }

  console.log("完成。");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await prisma.$disconnect();
  });
