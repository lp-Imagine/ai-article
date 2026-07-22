import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { highlightCodeBlocks } from "@/lib/code-highlight";
import { normalizeCalloutBlocks } from "@/lib/wechat-style";
import { findOwnedArticle, requireUser } from "@/lib/api-auth";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;
  const article = await findOwnedArticle(id, user.id);
  if (!article) {
    return NextResponse.json(
      { code: 404, message: "article not found", data: null },
      { status: 404 },
    );
  }
  if (!article.content) {
    return NextResponse.json(
      { code: 400, message: "正文为空，无需刷新格式", data: null },
      { status: 400 },
    );
  }

  // 修复卡片/加粗标记，并重新高亮代码块
  const highlighted = highlightCodeBlocks(normalizeCalloutBlocks(article.content));

  await db.article.update({
    where: { id },
    data: { content: highlighted, status: article.status === "generated" ? "edited" : article.status },
  });

  return NextResponse.json({
    code: 0,
    message: "正文格式已刷新",
    data: { content: highlighted },
  });
}
