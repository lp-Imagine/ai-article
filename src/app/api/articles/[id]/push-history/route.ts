import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

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
