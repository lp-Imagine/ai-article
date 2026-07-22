import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateCoverPrompt } from "@/lib/ai";
import { generateCoverImage } from "@/lib/image-gen";
import { syncConfigsToEnv } from "@/lib/config-bridge";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  await syncConfigsToEnv();

  const article = await db.article.findUnique({
    where: { id },
  });

  if (!article) {
    return NextResponse.json(
      { code: 404, message: "article not found", data: null },
      { status: 404 }
    );
  }

  try {
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
    const { url, source } = await generateCoverImage(prompt);

    const image = await db.imageAsset.create({
      data: {
        articleId: id,
        type: "cover",
        source: source === "ai" ? "ai" : "external",
        url,
        prompt,
        sortOrder: 0,
      },
    });

    const updated = await db.article.update({
      where: { id },
      data: {
        coverImageUrl: url,
        status: article.status === "draft" ? "edited" : article.status,
      },
    });

    return NextResponse.json({
      code: 0,
      message: "ok",
      data: { coverImageUrl: updated.coverImageUrl, image, prompt },
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: 1500,
        message: error instanceof Error ? error.message : "cover failed",
        data: null,
      },
      { status: 500 }
    );
  }
}
