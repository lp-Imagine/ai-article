import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { withUserConfig } from "@/lib/config-bridge";

export function unauthorized(message = "请先登录") {
  return NextResponse.json({ code: 401, message, data: null }, { status: 401 });
}

export function forbidden(message = "没有权限") {
  return NextResponse.json({ code: 403, message, data: null }, { status: 403 });
}

export function notFound(message = "资源不存在") {
  return NextResponse.json({ code: 404, message, data: null }, { status: 404 });
}

export async function requireUser(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return user;
}

export async function requireSuperAdmin(): Promise<SessionUser | NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  if (user.role !== "SUPER_ADMIN") return forbidden("仅超级管理员可访问");
  return user;
}

export async function findOwnedArticle(
  id: string,
  userId: string,
  include?: Prisma.ArticleInclude,
) {
  return db.article.findFirst({
    where: { id, userId },
    include,
  });
}

export async function withAuthUserConfig<T>(
  user: SessionUser,
  fn: () => Promise<T>,
): Promise<T> {
  return withUserConfig(user.id, fn);
}
