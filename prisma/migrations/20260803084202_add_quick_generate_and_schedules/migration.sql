-- AlterEnum
ALTER TYPE "GenerationJobType" ADD VALUE 'quick_generate';

-- CreateTable
CREATE TABLE "ArticleSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topicSource" TEXT NOT NULL DEFAULT 'fixed',
    "fixedTopic" TEXT,
    "keywords" TEXT,
    "style" TEXT,
    "wordCount" INTEGER,
    "audience" TEXT,
    "goal" TEXT,
    "autoPush" BOOLEAN NOT NULL DEFAULT false,
    "scheduleType" TEXT NOT NULL DEFAULT 'daily',
    "hour" INTEGER NOT NULL DEFAULT 9,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "weekday" INTEGER,
    "intervalHours" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastArticleId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleSchedule_userId_enabled_idx" ON "ArticleSchedule"("userId", "enabled");

-- CreateIndex
CREATE INDEX "ArticleSchedule_enabled_nextRunAt_idx" ON "ArticleSchedule"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "ArticleSchedule" ADD CONSTRAINT "ArticleSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
