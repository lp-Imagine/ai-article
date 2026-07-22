import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { findOwnedArticle, notFound, requireUser } from "@/lib/api-auth";

const bodySchema = z.object({
  outlineIndex: z.number().int().min(0),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await context.params;
    const existing = await findOwnedArticle(id, user.id);
    if (!existing) return notFound("文章不存在");

    const json = await request.json();
    const input = bodySchema.parse(json);

    const article = await db.article.update({
      where: { id },
      data: {
        selectedOutlineIndex: input.outlineIndex,
        status: "outlined",
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
        code: 1002,
        message: error instanceof Error ? error.message : "选择大纲失败",
        data: null,
      },
      { status: 400 },
    );
  }
}
