import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { highlightCodeBlocks } from "@/lib/code-highlight";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const article = await db.article.findUnique({ where: { id } });
  if (!article) {
    return NextResponse.json(
      { code: 404, message: "article not found", data: null },
      { status: 404 },
    );
  }
  if (!article.content) {
    return NextResponse.json(
      { code: 400, message: "正文为空，无需重新高亮", data: null },
      { status: 400 },
    );
  }

  // 重新走一遍代码高亮（替代之前生成时调用过 highlightCodeBlocks 的结果）
  const highlighted = highlightCodeBlocks(article.content);

  await db.article.update({
    where: { id },
    data: { content: highlighted, status: article.status === "generated" ? "edited" : article.status },
  });

  return NextResponse.json({
    code: 0,
    message: "代码块已重新高亮",
    data: { content: highlighted },
  });
}
