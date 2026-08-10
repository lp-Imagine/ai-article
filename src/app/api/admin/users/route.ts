import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/api-auth";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";

export async function GET(request: Request) {
  const admin = await requireSuperAdmin();
  if (admin instanceof NextResponse) return admin;

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip } = parsePagination(searchParams);

  const [total, users] = await Promise.all([
    db.user.count(),
    db.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        disabled: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { articles: true } },
      },
    }),
  ]);

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: {
      items: users.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        disabled: u.disabled,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        articleCount: u._count.articles,
      })),
      ...buildPaginationMeta(total, page, pageSize),
    },
  });
}
