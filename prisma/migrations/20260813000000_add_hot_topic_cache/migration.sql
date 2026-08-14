-- LLM 热点选题缓存：跨实例共享，1 小时 TTL
CREATE TABLE "HotTopicCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "section" TEXT,
    "category" TEXT,
    "topicsJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotTopicCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HotTopicCache_cacheKey_key" ON "HotTopicCache"("cacheKey");
CREATE INDEX "HotTopicCache_expiresAt_idx" ON "HotTopicCache"("expiresAt");
