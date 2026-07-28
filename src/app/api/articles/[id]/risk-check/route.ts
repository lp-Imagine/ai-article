import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findOwnedArticle, requireUser } from "@/lib/api-auth";
import {
  analyzeContentQuality,
  qualityIssuesToMessages,
} from "@/lib/content-quality";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;
  const article = await findOwnedArticle(id, user.id);
  if (!article) {
    return NextResponse.json(
      { code: 404, message: "article not found", data: null },
      { status: 404 }
    );
  }

  const analysis = analyzeContentQuality({
    title: article.title,
    summary: article.summary,
    content: article.content,
  });

  const issues = qualityIssuesToMessages(analysis.issues);
  const { score, suggestions } = analysis;

  await db.riskCheck.create({
    data: {
      articleId: id,
      score,
      issues: JSON.stringify(issues),
      suggestions: JSON.stringify(suggestions),
    },
  });

  await db.article.update({
    where: { id },
    data: { status: "checked" },
  });

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: {
      score,
      issues,
      suggestions,
      plainLength: analysis.plainLength,
      clicheHits: analysis.clicheHits,
    },
  });
}
