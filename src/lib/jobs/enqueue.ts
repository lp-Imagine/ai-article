import { NextResponse } from "next/server";
import { Prisma, type GenerationJob, type GenerationJobType } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import {
  getDailyJobLimit,
  getMaxConcurrentJobsPerUser,
  isQuotaExempt,
} from "@/lib/jobs/limits";
import { kickJobWorker } from "@/lib/jobs/worker";

export class JobLimitError extends Error {
  status: number;
  code: number;

  constructor(message: string, status = 429, code = 1429) {
    super(message);
    this.name = "JobLimitError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 日配额按本地时区日界重置：默认 Asia/Shanghai（UTC+8，无夏令时），
 * 即国内用户每天 0 点配额归零（此前按 UTC 日界会在早上 8 点才重置）。
 * 可通过 JOB_DAILY_LIMIT_TZ_OFFSET_HOURS 覆盖。
 */
function startOfQuotaDay(date = new Date()): Date {
  const raw = Number(process.env.JOB_DAILY_LIMIT_TZ_OFFSET_HOURS ?? "");
  const offsetHours = Number.isFinite(raw) ? Math.floor(raw) : 8;
  const shiftMs = offsetHours * 3_600_000;
  const shifted = new Date(date.getTime() + shiftMs);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      shiftMs,
  );
}

export async function enqueueGenerationJob(options: {
  user: SessionUser;
  articleId: string;
  type: GenerationJobType;
  payload?: Prisma.InputJsonValue;
}): Promise<GenerationJob> {
  const { user, articleId, type, payload } = options;

  const existing = await db.generationJob.findFirst({
    where: {
      articleId,
      type,
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    kickJobWorker();
    return existing;
  }

  if (!isQuotaExempt(user.role)) {
    const maxConcurrent = getMaxConcurrentJobsPerUser();
    const activeCount = await db.generationJob.count({
      where: {
        userId: user.id,
        status: { in: ["queued", "running"] },
      },
    });
    if (activeCount >= maxConcurrent) {
      throw new JobLimitError(
        `同时进行的任务过多（最多 ${maxConcurrent} 个），请等待完成后再试`,
      );
    }

    const dailyLimit = getDailyJobLimit();
    if (dailyLimit !== null) {
      const since = startOfQuotaDay();
      const todayCount = await db.generationJob.count({
        where: {
          userId: user.id,
          createdAt: { gte: since },
          status: { not: "cancelled" },
        },
      });
      if (todayCount >= dailyLimit) {
        throw new JobLimitError(
          `今日生成次数已达上限（${dailyLimit} 次），请明天再试或联系管理员`,
        );
      }
    }
  }

  let job: GenerationJob;
  try {
    job = await db.generationJob.create({
      data: {
        userId: user.id,
        articleId,
        type,
        status: "queued",
        progress: 0,
        stepLabel: "排队中",
        payload: payload ?? undefined,
      },
    });
  } catch (error) {
    // 并发双击 / 重复请求的竞态兜底：部分唯一索引 (articleId, type) 命中冲突时，
    // 返回已存在的进行中任务，避免同一文章同一类型重复生成。
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.generationJob.findFirst({
        where: {
          articleId,
          type,
          status: { in: ["queued", "running"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        kickJobWorker();
        return existing;
      }
    }
    throw error;
  }

  kickJobWorker();
  return job;
}

export function jobAcceptedResponse(job: GenerationJob, message = "任务已排队") {
  return NextResponse.json(
    {
      code: 0,
      message,
      data: {
        jobId: job.id,
        status: job.status,
        type: job.type,
        progress: job.progress,
        stepLabel: job.stepLabel,
      },
    },
    { status: 202 },
  );
}

export function jobLimitErrorResponse(error: unknown) {
  if (error instanceof JobLimitError) {
    return NextResponse.json(
      { code: error.code, message: error.message, data: null },
      { status: error.status },
    );
  }
  return null;
}
