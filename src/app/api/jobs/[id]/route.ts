import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notFound, requireUser } from "@/lib/api-auth";
import { jobDisplayLabel } from "@/lib/jobs/limits";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const job = await db.generationJob.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      articleId: true,
      type: true,
      status: true,
      progress: true,
      stepLabel: true,
      error: true,
      payload: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!job) return notFound("任务不存在");

  const { payload, ...rest } = job;
  return NextResponse.json({
    code: 0,
    message: "ok",
    data: {
      ...rest,
      label: jobDisplayLabel(rest.type, payload),
    },
  });
}
