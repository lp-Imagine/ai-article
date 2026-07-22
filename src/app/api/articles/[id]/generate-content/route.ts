import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateContent, generateCoverPrompt } from "@/lib/ai";
import { generateCoverImage } from "@/lib/image-gen";
import { findOwnedArticle, notFound, requireUser, withAuthUserConfig } from "@/lib/api-auth";

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
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  return withAuthUserConfig(user, async () => {
    const article = await findOwnedArticle(id, user.id);
    if (!article) return notFound("文章不存在");

    const outlines = Array.isArray(article.outline) ? (article.outline as OutlineRecord[]) : [];

    if (typeof article.selectedOutlineIndex !== "number") {
      return NextResponse.json(
        { code: 1003, message: "请先选择一个大纲方案，再生成正文", data: null },
        { status: 400 },
      );
    }

    const selectedOutline = outlines[article.selectedOutlineIndex] ?? null;

    if (!selectedOutline) {
      return NextResponse.json(
        { code: 1003, message: "所选大纲不存在，请重新选择", data: null },
        { status: 400 },
      );
    }

    const generated = await generateContent({
      topic: article.topic,
      outline: selectedOutline,
      style: article.style,
      wordCount: article.wordCount,
      audience: article.audience,
      goal: article.goal,
      keywords: article.keywords,
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
        contentExcerpt: generated.content,
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
  });
}
