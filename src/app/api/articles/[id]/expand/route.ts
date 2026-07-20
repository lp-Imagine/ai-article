import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { expandSection } from "@/lib/ai";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    instruction?: string;
  };

  const article = await db.article.findUnique({
    where: { id },
  });

  if (!article) {
    return NextResponse.json(
      { code: 404, message: "article not found", data: null },
      { status: 404 }
    );
  }

  if (!article.content) {
    return NextResponse.json(
      { code: 1003, message: "正文为空，先生成正文再扩写", data: null },
      { status: 400 }
    );
  }

  try {
    const content = await expandSection({
      content: article.content,
      instruction: body.instruction,
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
        code: 1503,
        message: error instanceof Error ? error.message : "扩写失败",
        data: null,
      },
      { status: 500 }
    );
  }
}