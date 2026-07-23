import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notFound, requireUser } from "@/lib/api-auth";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const job = await db.generationJob.findFirst({
    where: { id, userId: user.id },
  });
  if (!job) return notFound("任务不存在");

  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
    return NextResponse.json({
      code: 0,
      message: "任务已结束",
      data: job,
    });
  }

  // queued 可直接取消；running 标记取消（当前 worker 不会中途打断 AI，但前端可停止等待）
  const updated = await db.generationJob.update({
    where: { id },
    data: {
      status: "cancelled",
      stepLabel: "已取消",
      finishedAt: new Date(),
      error: job.status === "running" ? "用户取消（若已在执行可能仍会写回结果）" : null,
    },
  });

  return NextResponse.json({
    code: 0,
    message: "已取消",
    data: updated,
  });
}
