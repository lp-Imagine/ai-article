import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSummary } from "@/lib/ai";
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

    const { summary, coverText, source } = await generateSummary({
      topic: article.topic,
      title: article.title,
      content: article.content,
    });

    const updated = await db.article.update({
      where: { id },
      data: {
        summary,
        status: article.status === "generated" ? "edited" : article.status,
      },
    });

    return NextResponse.json({
      code: 0,
      message: "ok",
      data: {
        ...updated,
        coverText,
        source,
      },
    });
  });
}
