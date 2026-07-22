import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { polishContent } from "@/lib/ai";
import { findOwnedArticle, requireUser, withAuthUserConfig } from "@/lib/api-auth";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  return withAuthUserConfig(user, async () => {
    const body = (await req.json().catch(() => ({}))) as {
      mode?: "更正式" | "更口语" | "更简洁" | "更营销";
    };
    const mode = body.mode ?? "更简洁";

    const article = await findOwnedArticle(id, user.id);
    if (!article) {
      return NextResponse.json(
        { code: 404, message: "article not found", data: null },
        { status: 404 }
      );
    }

    if (!article.content) {
      return NextResponse.json(
        { code: 1003, message: "正文为空，先生成正文再润色", data: null },
        { status: 400 }
      );
    }

    try {
      const content = await polishContent({
        content: article.content,
        mode,
      });

      await db.articleVersion.create({
        data: {
          articleId: id,
          versionType: "polished",
          source: "ai",
          title: article.title,
          summary: article.summary,
          content,
        },
      });

      const updated = await db.article.update({
        where: { id },
        data: { content, status: "edited" },
      });

      return NextResponse.json({
        code: 0,
        message: "ok",
        data: updated,
      });
    } catch (error) {
      return NextResponse.json(
        {
          code: 1502,
          message: error instanceof Error ? error.message : "润色失败",
          data: null,
        },
        { status: 500 }
      );
    }
  });
}
