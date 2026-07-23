import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { jobDisplayLabel } from "@/lib/jobs/limits";

export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { searchParams } = new URL(request.url);
  const articleId = searchParams.get("articleId");
  const activeOnly = searchParams.get("active") === "1";

  const jobs = await db.generationJob.findMany({
    where: {
      userId: user.id,
      ...(articleId ? { articleId } : {}),
      ...(activeOnly ? { status: { in: ["queued", "running"] } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
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

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: jobs.map(({ payload, ...job }) => ({
      ...job,
      label: jobDisplayLabel(job.type, payload),
    })),
  });
}
