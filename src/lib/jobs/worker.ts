import { db } from "@/lib/db";
import { getStaleRunningJobMs } from "@/lib/jobs/limits";
import { runGenerationJob } from "@/lib/jobs/runners";

const POLL_INTERVAL_MS = 1500;
const MAX_PARALLEL_JOBS = 1;
const RECOVER_INTERVAL_MS = 30_000;

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
    console.warn(`[job-worker] requeued ${result.count} orphaned running job(s) after startup`);
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
    console.warn(`[job-worker] recovered ${result.count} stale running job(s)`);
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
    console.error(`[job-worker] job ${job.id} failed:`, message);
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

async function processOne() {
  if (activeCount >= MAX_PARALLEL_JOBS) return;

  const job = await claimNextJob();
  if (!job) return;

  // 不阻塞 tick：否则一次卡住的 LLM 请求会挡住超时回收
  void runClaimedJob(job);
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
    await processOne();
  } catch (error) {
    console.error("[job-worker] tick error:", error);
  } finally {
    claiming = false;
  }
}

export function startJobWorker() {
  if (started) return;
  started = true;
  console.log("[job-worker] started");
  void recoverOrphanedJobsOnStartup()
    .then(() => recoverStaleJobs())
    .then(() => tick())
    .catch((err) => {
      console.error("[job-worker] startup recover failed:", err);
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
