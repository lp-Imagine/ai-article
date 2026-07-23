import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { JOB_TYPE_LABELS } from "@/lib/jobs/limits";

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
  });

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: jobs.map((job) => ({
      ...job,
      label: JOB_TYPE_LABELS[job.type],
    })),
  });
}
