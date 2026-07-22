import { NextResponse } from "next/server";
import { generateTitles } from "@/lib/ai";
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

    const titles = await generateTitles({
      topic: article.topic,
      style: article.style,
      outlineTitle: article.title,
      contentSummary: article.summary,
      content: article.content,
    });

    return NextResponse.json({
      code: 0,
      message: "ok",
      data: { titles },
    });
  });
}
