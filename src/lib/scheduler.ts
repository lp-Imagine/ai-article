import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import type { ArticleSchedule } from "@prisma/client";
import { withUserConfig } from "@/lib/config-bridge";
import { enqueueGenerationJob } from "@/lib/jobs/enqueue";
import { getTopicIdeas } from "@/lib/topic-ideas";

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
      console.warn(
        `[scheduler] schedule=${schedule.id} ideas pick failed:`,
        err instanceof Error ? err.message : err,
      );
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

  const sessionUser: SessionUser = {
    id: user.id,
    username: user.username,
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
        nextRunAt: computeNextRunAt(schedule, now),
      },
    });
    console.log(
      `[scheduler] schedule=${schedule.id} triggered article=${article.id} job=${job.id}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "执行失败";
    console.error(`[scheduler] schedule=${schedule.id} failed:`, message);
    await db.articleSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        lastError: message,
        // 失败也要推进 nextRunAt，避免死循环重试
        nextRunAt: computeNextRunAt(schedule, now),
      },
    });
  }
}

async function tick() {
  try {
    const now = new Date();
    const due = await db.articleSchedule.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
      },
      orderBy: { nextRunAt: "asc" },
      take: MAX_BATCH_PER_TICK,
    });
    for (const schedule of due) {
      // 串行执行，避免同 tick 多任务争抢 LLM 配额
      await runOneSchedule(schedule);
    }
  } catch (err) {
    console.error(
      "[scheduler] tick failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * 启动定时调度器（globalThis 单例，跨 HMR 持久）。
 * 在 instrumentation.ts 或服务启动时调用一次即可。
 */
export function ensureSchedulerStarted() {
  if (g.__articleSchedulerStarted) return;
  g.__articleSchedulerStarted = true;
  console.log("[scheduler] started, tick every", TICK_MS / 1000, "s");
  // 启动后先延迟一个 tick 再执行，避免启动期 DB 未就绪
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_MS);
  }, 5_000);
}
