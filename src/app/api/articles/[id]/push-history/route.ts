import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findOwnedArticle, notFound, requireUser } from "@/lib/api-auth";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;
  const article = await findOwnedArticle(id, user.id);
  if (!article) return notFound("文章不存在");

  const records = await db.publishRecord.findMany({
    where: { articleId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      channel: true,
      status: true,
      errorMessage: true,
      createdAt: true,
    },
    take: 10,
  });

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: records,
  });
}
