import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSummary } from "@/lib/ai";

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
}
