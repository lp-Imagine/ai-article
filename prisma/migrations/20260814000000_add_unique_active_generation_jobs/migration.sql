-- 同一文章同一任务类型同时只允许一个 queued/running 任务。
-- 应用层 enqueueGenerationJob 已做 check-then-insert 去重，但并发双击存在竞态；
-- 此部分唯一索引是硬保证，命中冲突时应用层捕获 P2002 并返回已存在的任务。

-- 先清理历史遗留的重复进行中任务：每个 (articleId, type) 只保留最新一条
DELETE FROM "GenerationJob" a
USING "GenerationJob" b
WHERE a."articleId" = b."articleId"
  AND a."type" = b."type"
  AND a."status" IN ('queued', 'running')
  AND b."status" IN ('queued', 'running')
  AND (
    a."createdAt" < b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" < b."id")
  );

CREATE UNIQUE INDEX "GenerationJob_active_unique"
ON "GenerationJob" ("articleId", "type")
WHERE "status" IN ('queued', 'running');
