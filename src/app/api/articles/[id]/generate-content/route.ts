import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateContent, generateCoverPrompt } from "@/lib/ai";
import { generateCoverImage } from "@/lib/image-gen";
import { syncConfigsToEnv } from "@/lib/config-bridge";

type OutlineRecord = {
  index: number;
  title: string;
  positioning: string;
  sections: Array<{
    heading: string;
    summary: string;
  }>;
};

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  await syncConfigsToEnv();

  const article = await db.article.findUnique({
    where: { id },
  });

  if (!article) {
    return NextResponse.json(
      { code: 404, message: "文章不存在", data: null },
      { status: 404 },
    );
  }

  const outlines = Array.isArray(article.outline) ? (article.outline as OutlineRecord[]) : [];
  const selectedOutline =
    typeof article.selectedOutlineIndex === "number"
      ? outlines[article.selectedOutlineIndex] ?? null
      : outlines[0] ?? null;

  const generated = await generateContent({
    topic: article.topic,
    outline: selectedOutline,
    style: article.style,
    wordCount: article.wordCount,
  });

  // 顺手生成封面图（不影响正文，封面失败也不中断）
  let coverImageUrl: string | null = null;
  let coverWarning: string | null = null;
  try {
    const keyPoints = (selectedOutline?.sections ?? [])
      .slice(0, 3)
      .map((s) => s.heading);
    const coverPrompt = await generateCoverPrompt(article.topic, article.style, {
      title: generated.title,
      summary: generated.summary,
      keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
    });
    const cover = await generateCoverImage(coverPrompt);
    coverImageUrl = cover.url;

    // 记录到 image_assets 表
    await db.imageAsset.create({
      data: {
        articleId: id,
        type: "cover",
        source: cover.source === "ai" ? "ai" : "upload",
        url: cover.url,
        prompt: coverPrompt,
      },
    });
  } catch (err) {
    coverWarning = err instanceof Error ? err.message : "封面图生成失败";
    console.error("[generate-content] cover failed:", coverWarning);
  }

  const updated = await db.article.update({
    where: { id },
    data: {
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
      ...(coverImageUrl ? { coverImageUrl } : {}),
      status: "generated",
    },
  });

  await db.articleVersion.create({
    data: {
      articleId: id,
      versionType: "generated",
      source: "ai",
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
    },
  });

  return NextResponse.json({
    code: 0,
    message: coverWarning
      ? `正文已生成，封面图失败：${coverWarning}`
      : "正文与封面图已生成",
    data: { ...updated, coverWarning },
  });
}