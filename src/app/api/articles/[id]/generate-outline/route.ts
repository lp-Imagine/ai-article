import { NextResponse } from "next/server";
import { findOwnedArticle, notFound, requireUser } from "@/lib/api-auth";
import { enqueueGenerationJob, jobAcceptedResponse, jobLimitErrorResponse } from "@/lib/jobs/enqueue";

function trimSeed(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const article = await findOwnedArticle(id, user.id);
  if (!article) return notFound("文章不存在");

  let outlineCount = article.outlineCount ?? 3;
  let seedInsight: string | undefined;
  let seedTension: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.outlineCount === "number" && body.outlineCount >= 2 && body.outlineCount <= 6) {
      outlineCount = body.outlineCount;
    }
    seedInsight = trimSeed(body?.seedInsight, 72);
    seedTension = trimSeed(body?.seedTension, 120);
  } catch {
    // ignore
  }

  try {
    const job = await enqueueGenerationJob({
      user,
      articleId: id,
      type: "outline",
      payload: {
        outlineCount,
        ...(seedInsight ? { seedInsight } : {}),
        ...(seedTension ? { seedTension } : {}),
      },
    });
    return jobAcceptedResponse(job, "大纲生成任务已排队");
  } catch (error) {
    return jobLimitErrorResponse(error) ?? NextResponse.json(
      { code: 1501, message: error instanceof Error ? error.message : "排队失败", data: null },
      { status: 500 },
    );
  }
}
