import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateTitles } from "@/lib/ai";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const article = await db.article.findUnique({
    where: { id },
  });

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
  });

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: { titles },
  });
}