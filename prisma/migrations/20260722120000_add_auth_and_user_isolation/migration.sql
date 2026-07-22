-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Bootstrap super admin (password: admin123) — seed/ensureBootstrapAdmin 会按环境变量覆盖
INSERT INTO "User" ("id", "username", "passwordHash", "displayName", "role", "disabled", "createdAt", "updatedAt")
VALUES (
  'bootstrap_super_admin',
  'admin',
  '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  '超级管理员',
  'SUPER_ADMIN',
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "keywords" TEXT,
    "title" TEXT,
    "subtitle" TEXT,
    "summary" TEXT,
    "outline" JSONB,
    "content" TEXT,
    "style" TEXT,
    "audience" TEXT,
    "goal" TEXT,
    "wordCount" INTEGER,
    "outlineCount" INTEGER DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "coverImageUrl" TEXT,
    "selectedOutlineIndex" INTEGER,
    "wechatDraftId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Article_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Article" (
  "id", "userId", "topic", "keywords", "title", "subtitle", "summary", "outline", "content",
  "style", "audience", "goal", "wordCount", "outlineCount", "status", "coverImageUrl",
  "selectedOutlineIndex", "wechatDraftId", "createdAt", "updatedAt"
)
SELECT
  "id", 'bootstrap_super_admin', "topic", "keywords", "title", "subtitle", "summary", "outline", "content",
  "style", "audience", "goal", "wordCount", "outlineCount", "status", "coverImageUrl",
  "selectedOutlineIndex", "wechatDraftId", "createdAt", "updatedAt"
FROM "Article";

DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE INDEX "Article_userId_idx" ON "Article"("userId");

CREATE TABLE "new_AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "configValue" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_AppConfig" ("id", "userId", "configKey", "configValue", "createdAt", "updatedAt")
SELECT "id", 'bootstrap_super_admin', "configKey", "configValue", "createdAt", "updatedAt"
FROM "AppConfig";

DROP TABLE "AppConfig";
ALTER TABLE "new_AppConfig" RENAME TO "AppConfig";
CREATE INDEX "AppConfig_userId_idx" ON "AppConfig"("userId");
CREATE UNIQUE INDEX "AppConfig_userId_configKey_key" ON "AppConfig"("userId", "configKey");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
