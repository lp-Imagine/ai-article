import { NextResponse } from "next/server";
import { findOwnedArticle, notFound, requireUser } from "@/lib/api-auth";
import { enqueueGenerationJob, jobAcceptedResponse, jobLimitErrorResponse } from "@/lib/jobs/enqueue";

type OutlineRecord = {
  index: number;
  title: string;
  positioning: string;
  sections: Array<{ heading: string; summary: string }>;
};

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const article = await findOwnedArticle(id, user.id);
  if (!article) return notFound("文章不存在");

  const outlines = Array.isArray(article.outline) ? (article.outline as OutlineRecord[]) : [];
  if (typeof article.selectedOutlineIndex !== "number") {
    return NextResponse.json(
      { code: 1003, message: "请先选择一个大纲方案，再生成正文", data: null },
      { status: 400 },
    );
  }
  if (!outlines[article.selectedOutlineIndex]) {
    return NextResponse.json(
      { code: 1003, message: "所选大纲不存在，请重新选择", data: null },
      { status: 400 },
    );
  }

  try {
    const job = await enqueueGenerationJob({
      user,
      articleId: id,
      type: "content",
    });
    return jobAcceptedResponse(job, "正文生成任务已排队");
  } catch (error) {
    return jobLimitErrorResponse(error) ?? NextResponse.json(
      { code: 1500, message: error instanceof Error ? error.message : "排队失败", data: null },
      { status: 500 },
    );
  }
}
