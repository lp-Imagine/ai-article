import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const updateArticleSchema = z.object({
  title: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  status: z
    .enum(["draft", "outlined", "generated", "edited", "checked", "pushed", "failed"])
    .optional(),
  coverImageUrl: z.string().optional().nullable(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const article = await db.article.findUnique({
    where: { id },
    include: {
      images: true,
      publishRecords: {
        orderBy: {
          createdAt: "desc",
        },
      },
      riskChecks: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!article) {
    return NextResponse.json(
      { code: 404, message: "文章不存在", data: null },
      { status: 404 },
    );
  }

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: article,
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const json = await request.json();
    const input = updateArticleSchema.parse(json);

    const article = await db.article.update({
      where: { id },
      data: {
        title: input.title,
        summary: input.summary,
        content: input.content,
        coverImageUrl: input.coverImageUrl,
        status: input.status ?? "edited",
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
        code: 1001,
        message: error instanceof Error ? error.message : "保存文章失败",
        data: null,
      },
      { status: 400 },
    );
  }
}
