import { NextResponse } from "next/server";
import { findOwnedArticle, notFound, requireUser } from "@/lib/api-auth";
import { enqueueGenerationJob, jobAcceptedResponse, jobLimitErrorResponse } from "@/lib/jobs/enqueue";

/** 仅整理 HTML/排版结构，不改写文意（导入稿常用） */
export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const article = await findOwnedArticle(id, user.id);
  if (!article) return notFound("文章不存在");
  if (!article.content) {
    return NextResponse.json(
      { code: 1003, message: "正文为空，无法整理格式", data: null },
      { status: 400 },
    );
  }

  try {
    const job = await enqueueGenerationJob({
      user,
      articleId: id,
      type: "polish",
      payload: { mode: "reformat" },
    });
    return jobAcceptedResponse(job, "格式整理任务已排队");
  } catch (error) {
    return (
      jobLimitErrorResponse(error) ??
      NextResponse.json(
        { code: 1502, message: error instanceof Error ? error.message : "排队失败", data: null },
        { status: 500 },
      )
    );
  }
}
