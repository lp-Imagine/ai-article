import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import type { ArticleSchedule } from "@prisma/client";
import { withUserConfig } from "@/lib/config-bridge";
import { enqueueGenerationJob } from "@/lib/jobs/enqueue";
import { getTopicIdeas } from "@/lib/topic-ideas";
import { log } from "@/lib/log";

const TICK_MS = 60_000; // 每 60 秒检查一次到期任务
const MAX_BATCH_PER_TICK = 5; // 每轮最多触发的任务数，避免雪崩

type GlobalWithScheduler = typeof globalThis & {
  __articleSchedulerStarted?: boolean;
};
const g = globalThis as GlobalWithScheduler;

/**
 * 计算下一次执行时间（本地时区）。
 */
export function computeNextRunAt(
  schedule: Pick<
    ArticleSchedule,
    "scheduleType" | "hour" | "minute" | "weekday" | "intervalHours"
  >,
  fromDate = new Date(),
): Date {
  const { scheduleType, hour, minute, weekday, intervalHours } = schedule;

  if (scheduleType === "interval_hours" && intervalHours && intervalHours > 0) {
    return new Date(fromDate.getTime() + intervalHours * 3_600_000);
  }

  if (scheduleType === "weekly") {
    const d = new Date(fromDate);
    d.setHours(hour, minute, 0, 0);
    const target = typeof weekday === "number" ? weekday : 1;
    let daysToAdd = (target - d.getDay() + 7) % 7;
    if (daysToAdd === 0 && d.getTime() <= fromDate.getTime()) daysToAdd = 7;
    d.setDate(d.getDate() + daysToAdd);
    return d;
  }

  // daily：今天 hour:minute，若已过则明天
  const d = new Date(fromDate);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= fromDate.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

async function pickTopicForSchedule(schedule: ArticleSchedule): Promise<string> {
  if (schedule.topicSource === "ideas") {
    // 从灵感中选一个（优先 AI 热点），失败则回退固定主题
    try {
      const result = await getTopicIdeas({
        userId: schedule.userId,
        count: 5,
        includeHot: true,
        cursor: schedule.runCount, // 每次偏移，避免重复
      });
      const idea = result.ideas[0];
      if (idea?.topic) return idea.topic;
    } catch (err) {
      log.warn("scheduler ideas pick failed", {
        scheduleId: schedule.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (schedule.fixedTopic?.trim()) return schedule.fixedTopic.trim();
  throw new Error("未配置主题（topicSource=ideas 且灵感不可用，且无 fixedTopic 兜底）");
}

async function runOneSchedule(schedule: ArticleSchedule) {
  const now = new Date();
  const user = await db.user.findUnique({ where: { id: schedule.userId } });
  if (!user || user.disabled) {
    await db.articleSchedule.update({
      where: { id: schedule.id },
      data: {
        enabled: false,
        lastError: "用户不存在或已禁用，任务已自动停用",
        nextRunAt: computeNextRunAt(schedule, now),
      },
    });
    return;
  }

  // 先推进 nextRunAt（tick 的 5 分钟占位 → 真实下次时间），再执行本轮任务：
  // 即使本实例在「创建文章/入队成功之后、更新 lastRunAt 之前」崩溃，
  // 其它实例 5 分钟后接管占位时也不会重复触发本轮到期的任务。
  // 代价是崩溃时可能漏跑一次——对定时发文而言，漏跑远好于重复推草稿。
  await db.articleSchedule.update({
    where: { id: schedule.id },
    data: { nextRunAt: computeNextRunAt(schedule, now) },
  });

  const sessionUser: SessionUser = {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };

  try {
    // LLM 调用（灵感选题）需要用户级配置
    const article = await withUserConfig(user.id, async () => {
      const topic = await pickTopicForSchedule(schedule);
      return db.article.create({
        data: {
          userId: user.id,
          topic,
          keywords: schedule.keywords,
          style: schedule.style,
          wordCount: schedule.wordCount,
          audience: schedule.audience,
          goal: schedule.goal,
          outlineCount: 3,
        },
      });
    });

    const job = await enqueueGenerationJob({
      user: sessionUser,
      articleId: article.id,
      type: "quick_generate",
      payload: { autoPush: schedule.autoPush },
    });

    await db.articleSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        runCount: { increment: 1 },
        lastArticleId: article.id,
        lastError: null,
      },
    });
    log.info("scheduler triggered", {
      scheduleId: schedule.id,
      articleId: article.id,
      jobId: job.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "执行失败";
    log.error("scheduler schedule failed", { scheduleId: schedule.id, error: message });
    // nextRunAt 已在开头推进，这里只记录失败状态，避免重复执行
    await db.articleSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        lastError: message,
      },
    });
  }
}

async function tick() {
  try {
    const now = new Date();

    // 集群互斥：用 SELECT ... FOR UPDATE SKIP LOCKED 一次性拿一批到期的 schedule，
    // 同时把它们 nextRunAt 推进到 5 分钟后的「临时占位」，让其他实例的 tick 看不到。
    // 后续 runOneSchedule 成功 / 失败时再覆盖为真正的 nextRunAt。
    //
    // 这样多实例部署时：N 个实例同时 tick，但只有先抢到行锁的那个实例会执行；
    // 5 分钟是兜底，万一某个实例在 runOneSchedule 阶段崩溃/重启，其它实例
    // 最迟 5 分钟后会接管它（视为失败一次并按 schedule 规则计算下一次）。
    const placeholder = new Date(now.getTime() + 5 * 60_000);
    const claimed = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "ArticleSchedule"
        WHERE "enabled" = true AND "nextRunAt" <= ${now}
        ORDER BY "nextRunAt" ASC
        LIMIT ${MAX_BATCH_PER_TICK}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx.articleSchedule.updateMany({
        where: { id: { in: ids } },
        data: { nextRunAt: placeholder },
      });
      // 再读一次拿到完整字段
      return tx.articleSchedule.findMany({
        where: { id: { in: ids } },
      });
    });

    for (const schedule of claimed) {
      // 串行执行，避免同 tick 多任务争抢 LLM 配额
      await runOneSchedule(schedule);
    }
  } catch (err) {
    log.error("scheduler tick failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 启动定时调度器（globalThis 单例，跨 HMR 持久）。
 * 在 instrumentation.ts 或服务启动时调用一次即可。
 */
export function ensureSchedulerStarted() {
  if (g.__articleSchedulerStarted) return;
  g.__articleSchedulerStarted = true;
  log.info("scheduler started", { tickMs: TICK_MS });
  // 启动后先延迟一个 tick 再执行，避免启动期 DB 未就绪
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_MS);
  }, 5_000);
}
