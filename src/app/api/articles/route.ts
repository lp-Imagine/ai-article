import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";

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
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const json = await request.json();
    const input = createArticleSchema.parse(json);

    const article = await db.article.create({
      data: {
        userId: user.id,
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

export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip } = parsePagination(searchParams);
  const where = { userId: user.id };

  const [total, articles] = await Promise.all([
    db.article.count({ where }),
    db.article.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: {
      items: articles,
      ...buildPaginationMeta(total, page, pageSize),
    },
  });
}

const batchDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "请选择要删除的文章").max(100),
});

export async function DELETE(request: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const input = batchDeleteSchema.parse(await request.json());
    const result = await db.article.deleteMany({
      where: {
        userId: user.id,
        id: { in: input.ids },
      },
    });

    return NextResponse.json({
      code: 0,
      message: "ok",
      data: { deleted: result.count },
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "批量删除失败",
        data: null,
      },
      { status: 400 },
    );
  }
}
