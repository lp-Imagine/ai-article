import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateOutline } from "@/lib/ai";
import { findOwnedArticle, notFound, requireUser, withAuthUserConfig } from "@/lib/api-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  return withAuthUserConfig(user, async () => {
    const article = await findOwnedArticle(id, user.id);
    if (!article) return notFound("文章不存在");

    // 优先从请求体读取 outlineCount（如首页第一次调用），其次读数据库中存储的值
    let outlineCount = article.outlineCount ?? 3;
    try {
      const body = await request.json().catch(() => ({}));
      if (typeof body?.outlineCount === "number" && body.outlineCount >= 2 && body.outlineCount <= 6) {
        outlineCount = body.outlineCount;
        // 同步回数据库
        await db.article.update({
          where: { id },
          data: { outlineCount },
        }).catch(() => {});
      }
    } catch {
      // 用数据库中的值
    }

    try {
      const outlines = await generateOutline({
        topic: article.topic,
        style: article.style,
        wordCount: article.wordCount,
        audience: article.audience,
        goal: article.goal,
        keywords: article.keywords,
        outlineCount,
      });

      await db.article.update({
        where: { id },
        data: {
          outline: outlines,
          outlineCount,
          status: "outlined",
        },
      });

      await db.articleVersion.create({
        data: {
          articleId: id,
          versionType: "outline",
          source: "ai",
          outline: outlines,
        },
      });

      return NextResponse.json({
        code: 0,
        message: "ok",
        data: { outlines, count: outlines.length },
      });
    } catch (error) {
      console.error("[generate-outline] failed:", error);
      return NextResponse.json(
        {
          code: 1501,
          message: error instanceof Error ? error.message : "生成大纲失败",
          data: null,
        },
        { status: 500 },
      );
    }
  });
}
