-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "status" TEXT NOT NULL DEFAULT 'draft',
    "coverImageUrl" TEXT,
    "selectedOutlineIndex" INTEGER,
    "wechatDraftId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ArticleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "versionType" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "title" TEXT,
    "summary" TEXT,
    "outline" JSONB,
    "content" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "localPath" TEXT,
    "prompt" TEXT,
    "wechatMediaId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageAsset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'wechat',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestPayload" TEXT,
    "responsePayload" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishRecord_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "score" INTEGER,
    "issues" TEXT,
    "suggestions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskCheck_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configKey" TEXT NOT NULL,
    "configValue" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ArticleVersion_articleId_idx" ON "ArticleVersion"("articleId");

-- CreateIndex
CREATE INDEX "ImageAsset_articleId_idx" ON "ImageAsset"("articleId");

-- CreateIndex
CREATE INDEX "PublishRecord_articleId_idx" ON "PublishRecord"("articleId");

-- CreateIndex
CREATE INDEX "RiskCheck_articleId_idx" ON "RiskCheck"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_configKey_key" ON "AppConfig"("configKey");
