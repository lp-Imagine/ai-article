-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('draft', 'outlined', 'generated', 'edited', 'checked', 'pushed', 'failed');

-- CreateEnum
CREATE TYPE "VersionType" AS ENUM ('outline', 'generated', 'polished', 'manual_edit');

-- CreateEnum
CREATE TYPE "VersionSource" AS ENUM ('ai', 'user', 'system');

-- CreateEnum
CREATE TYPE "ImageType" AS ENUM ('cover', 'inline');

-- CreateEnum
CREATE TYPE "ImageSource" AS ENUM ('ai', 'upload', 'external');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('pending', 'success', 'failed');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "GenerationJobType" AS ENUM ('outline', 'content', 'cover', 'inline_images', 'polish', 'expand');

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
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
    "status" "ArticleStatus" NOT NULL DEFAULT 'draft',
    "coverImageUrl" TEXT,
    "selectedOutlineIndex" INTEGER,
    "wechatDraftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleVersion" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "versionType" "VersionType" NOT NULL,
    "source" "VersionSource" NOT NULL DEFAULT 'ai',
    "title" TEXT,
    "summary" TEXT,
    "outline" JSONB,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "type" "ImageType" NOT NULL,
    "source" "ImageSource" NOT NULL,
    "url" TEXT,
    "localPath" TEXT,
    "prompt" TEXT,
    "wechatMediaId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishRecord" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'wechat',
    "status" "PublishStatus" NOT NULL DEFAULT 'pending',
    "requestPayload" TEXT,
    "responsePayload" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskCheck" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "score" INTEGER,
    "issues" TEXT,
    "suggestions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "configValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "type" "GenerationJobType" NOT NULL,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stepLabel" TEXT,
    "error" TEXT,
    "payload" JSONB,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Article_userId_idx" ON "Article"("userId");

-- CreateIndex
CREATE INDEX "ArticleVersion_articleId_idx" ON "ArticleVersion"("articleId");

-- CreateIndex
CREATE INDEX "ImageAsset_articleId_idx" ON "ImageAsset"("articleId");

-- CreateIndex
CREATE INDEX "PublishRecord_articleId_idx" ON "PublishRecord"("articleId");

-- CreateIndex
CREATE INDEX "RiskCheck_articleId_idx" ON "RiskCheck"("articleId");

-- CreateIndex
CREATE INDEX "AppConfig_userId_idx" ON "AppConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_userId_configKey_key" ON "AppConfig"("userId", "configKey");

-- CreateIndex
CREATE INDEX "GenerationJob_userId_status_idx" ON "GenerationJob"("userId", "status");

-- CreateIndex
CREATE INDEX "GenerationJob_articleId_type_status_idx" ON "GenerationJob"("articleId", "type", "status");

-- CreateIndex
CREATE INDEX "GenerationJob_status_createdAt_idx" ON "GenerationJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationJob_userId_createdAt_idx" ON "GenerationJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleVersion" ADD CONSTRAINT "ArticleVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishRecord" ADD CONSTRAINT "PublishRecord_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCheck" ADD CONSTRAINT "RiskCheck_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppConfig" ADD CONSTRAINT "AppConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bootstrap super admin placeholder (password overwritten by ensureBootstrapAdmin)
INSERT INTO "User" ("id", "username", "passwordHash", "displayName", "role", "disabled", "createdAt", "updatedAt")
VALUES (
  'bootstrap_super_admin',
  'admin',
  '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  '超级管理员',
  'SUPER_ADMIN',
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
