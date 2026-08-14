import { db } from "@/lib/db";
import { getStaleRunningJobMs } from "@/lib/jobs/limits";
import { runGenerationJob } from "@/lib/jobs/runners";
import { log } from "@/lib/log";

const POLL_INTERVAL_MS = 1500;
const RECOVER_INTERVAL_MS = 30_000;

/** 全局同时执行的生成任务上限。
 * 原来硬编码为 1，会导致 100 个用户并发时全部串行等待；
 * 改为通过 JOB_GLOBAL_CONCURRENCY 配置，默认 4，可按 LLM 配额上调。
 */
function getMaxParallelJobs(): number {
  const raw = Number(process.env.JOB_GLOBAL_CONCURRENCY ?? "4");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4;
}

let started = false;
let claiming = false;
let timer: ReturnType<typeof setInterval> | null = null;
let activeCount = 0;
let lastRecoverAt = 0;

async function recoverOrphanedJobsOnStartup() {
  const result = await db.generationJob.updateMany({
    where: { status: "running" },
    data: {
      status: "queued",
      progress: 0,
      stepLabel: "排队中（服务重启后恢复）",
      error: null,
      startedAt: null,
      finishedAt: null,
    },
  });
  if (result.count > 0) {
    log.warn("job-worker requeued orphans", { count: result.count });
  }
}

async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - getStaleRunningJobMs());
  const result = await db.generationJob.updateMany({
    where: {
      status: "running",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "failed",
      error: "任务超时未完成（模型请求过久或服务中断），请重试",
      finishedAt: new Date(),
      stepLabel: "已失败",
    },
  });
  if (result.count > 0) {
    log.warn("job-worker recovered stale jobs", { count: result.count });
  }
}

async function claimNextJob() {
  return db.$transaction(async (tx) => {
    const next = await tx.generationJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return null;

    const claimed = await tx.generationJob.updateMany({
      where: { id: next.id, status: "queued" },
      data: {
        status: "running",
        startedAt: new Date(),
        stepLabel: "执行中",
        progress: Math.max(next.progress, 1),
      },
    });
    if (claimed.count === 0) return null;

    return tx.generationJob.findUnique({ where: { id: next.id } });
  });
}

async function runClaimedJob(job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>) {
  activeCount += 1;
  try {
    const result = await runGenerationJob(job);
    const current = await db.generationJob.findUnique({ where: { id: job.id } });
    if (current?.status === "cancelled") {
      return;
    }
    await db.generationJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        progress: 100,
        stepLabel: "完成",
        resultJson: result ?? undefined,
        finishedAt: new Date(),
        error: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务执行失败";
    log.error("job-worker job failed", { jobId: job.id, error: message });
    const current = await db.generationJob.findUnique({ where: { id: job.id } }).catch(() => null);
    if (current?.status === "cancelled") return;
    await db.generationJob
      .update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: message,
          stepLabel: "失败",
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
  } finally {
    activeCount = Math.max(0, activeCount - 1);
  }
}

/**
 * 每轮尽量把并发额度填满。
 * 一次 tick 只领一个任务时，积压 N 个任务要等 N 轮轮询（N×1.5s）才全部跑起来。
 * runClaimedJob 会在首个 await 前同步自增 activeCount，因此循环条件可靠。
 */
async function fillJobSlots() {
  const max = getMaxParallelJobs();
  for (let claimed = 0; claimed < max && activeCount < max; claimed += 1) {
    const job = await claimNextJob();
    if (!job) return;

    // 不阻塞 tick：否则一次卡住的 LLM 请求会挡住超时回收
    void runClaimedJob(job);
  }
}

async function tick() {
  if (claiming) return;
  claiming = true;
  try {
    const now = Date.now();
    if (now - lastRecoverAt >= RECOVER_INTERVAL_MS) {
      lastRecoverAt = now;
      await recoverStaleJobs();
    }
    await fillJobSlots();
  } catch (error) {
    log.error("job-worker tick error", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    claiming = false;
  }
}

export function startJobWorker() {
  if (started) return;
  started = true;
  log.info("job-worker started");
  void recoverOrphanedJobsOnStartup()
    .then(() => recoverStaleJobs())
    .then(() => tick())
    .catch((err) => {
      log.error("job-worker startup recover failed", { error: err instanceof Error ? err.message : String(err) });
    });
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
}

export function kickJobWorker() {
  if (!started) startJobWorker();
  void tick();
}

export function stopJobWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
