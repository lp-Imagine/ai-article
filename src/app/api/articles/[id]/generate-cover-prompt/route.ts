import { NextResponse } from "next/server";
import { generateCoverPrompt } from "@/lib/ai";
import { findOwnedArticle, requireUser, withAuthUserConfig } from "@/lib/api-auth";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  return withAuthUserConfig(user, async () => {
    const article = await findOwnedArticle(id, user.id);
    if (!article) {
      return NextResponse.json(
        { code: 404, message: "article not found", data: null },
        { status: 404 }
      );
    }

    // 提取大纲关键节点作为封面视觉线索
    const outlines = Array.isArray(article.outline) ? article.outline as Array<{ sections?: Array<{ heading: string }> }> : [];
    const selectedIdx = typeof article.selectedOutlineIndex === "number" ? article.selectedOutlineIndex : 0;
    const selectedOutline = outlines[selectedIdx];
    const keyPoints = (selectedOutline?.sections ?? []).slice(0, 3).map((s) => s.heading);

    const prompt = await generateCoverPrompt(article.topic, article.style, {
      title: article.title,
      summary: article.summary,
      keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
      contentExcerpt: article.content,
    });

    return NextResponse.json({
      code: 0,
      message: "ok",
      data: { prompt },
    });
  });
}
