import { NextResponse } from "next/server";
import type { GenerationJob, GenerationJobType, Prisma } from "@prisma/client";
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

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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
      const since = startOfUtcDay();
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

  const job = await db.generationJob.create({
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
