import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { findOwnedArticle, notFound, requireUser } from "@/lib/api-auth";
import { hitRateLimit } from "@/lib/rate-limit";

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

    // 同一篇文章的选择操作做最低限度限频，避免脚本刷接口；
    // 窗口放宽到 2 秒 3 次，正常「切换对比几个大纲方案」不会被误伤。
    const throttle = hitRateLimit({
      key: `select-outline:article:${id}`,
      windowMs: 2_000,
      max: 3,
    });
    if (!throttle.ok) {
      return NextResponse.json(
        { code: 1002, message: "操作过于频繁，请稍后再试", data: null },
        { status: 429 },
      );
    }

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
