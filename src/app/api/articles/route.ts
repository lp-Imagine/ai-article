import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const createArticleSchema = z.object({
  topic: z.string().trim().min(1, "请输入主题"),
  keywords: z.string().optional(),
  style: z.string().optional(),
  wordCount: z.number().int().positive().max(5000).optional(),
  audience: z.string().optional(),
  goal: z.string().optional(),
  outlineCount: z.number().int().min(2).max(6).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = createArticleSchema.parse(json);

    const article = await db.article.create({
      data: {
        topic: input.topic,
        keywords: input.keywords,
        style: input.style,
        wordCount: input.wordCount,
        audience: input.audience,
        goal: input.goal,
        outlineCount: input.outlineCount ?? 3,
      },
    });

    return NextResponse.json({
      code: 0,
      message: "ok",
      data: article,
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "创建文章失败",
        data: null,
      },
      { status: 400 },
    );
  }
}

export async function GET() {
  const articles = await db.article.findMany({
    orderBy: { updatedAt: "desc" },
    take: 12,
  });

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: articles,
  });
}
