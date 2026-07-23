import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notFound, requireUser } from "@/lib/api-auth";
import { JOB_TYPE_LABELS } from "@/lib/jobs/limits";

export async function GET(
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

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: {
      ...job,
      label: JOB_TYPE_LABELS[job.type],
    },
  });
}
