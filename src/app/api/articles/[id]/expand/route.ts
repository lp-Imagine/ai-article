import { NextResponse } from "next/server";
import { findOwnedArticle, notFound, requireUser } from "@/lib/api-auth";
import { enqueueGenerationJob, jobAcceptedResponse, jobLimitErrorResponse } from "@/lib/jobs/enqueue";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const article = await findOwnedArticle(id, user.id);
  if (!article) return notFound("文章不存在");
  if (!article.content) {
    return NextResponse.json(
      { code: 1003, message: "正文为空，先生成正文再扩写", data: null },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { instruction?: string };

  try {
    const job = await enqueueGenerationJob({
      user,
      articleId: id,
      type: "expand",
      payload: { instruction: body.instruction },
    });
    return jobAcceptedResponse(job, "扩写任务已排队");
  } catch (error) {
    return jobLimitErrorResponse(error) ?? NextResponse.json(
      { code: 1503, message: error instanceof Error ? error.message : "排队失败", data: null },
      { status: 500 },
    );
  }
}
