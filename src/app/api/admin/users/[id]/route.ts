import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { destroyUserSessions } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { forbidden, notFound, requireSuperAdmin } from "@/lib/api-auth";

const patchSchema = z.object({
  disabled: z.boolean().optional(),
  displayName: z.string().trim().max(40).nullable().optional(),
  role: z.enum(["USER", "SUPER_ADMIN"]).optional(),
  password: z.string().min(6).max(72).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireSuperAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id } = await context.params;
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return notFound("用户不存在");

  try {
    const input = patchSchema.parse(await request.json());

    if (input.role === "USER" && user.role === "SUPER_ADMIN") {
      const adminCount = await db.user.count({
        where: { role: "SUPER_ADMIN", disabled: false },
      });
      if (adminCount <= 1) {
        return forbidden("不能取消最后一个超级管理员");
      }
    }

    if (input.disabled === true && user.id === admin.id) {
      return forbidden("不能禁用当前登录的账号");
    }

    if (input.disabled === true && user.role === "SUPER_ADMIN") {
      const adminCount = await db.user.count({
        where: { role: "SUPER_ADMIN", disabled: false },
      });
      if (adminCount <= 1) {
        return forbidden("不能禁用最后一个超级管理员");
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        disabled: input.disabled,
        displayName: input.displayName === undefined ? undefined : input.displayName,
        role: input.role,
        passwordHash: input.password ? hashPassword(input.password) : undefined,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        disabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (input.disabled === true || input.password) {
      await destroyUserSessions(id);
    }

    return NextResponse.json({ code: 0, message: "ok", data: updated });
  } catch (error) {
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "更新失败",
        data: null,
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireSuperAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id } = await context.params;
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return notFound("用户不存在");

  if (user.id === admin.id) {
    return forbidden("不能删除当前登录的账号");
  }

  if (user.role === "SUPER_ADMIN") {
    const adminCount = await db.user.count({ where: { role: "SUPER_ADMIN" } });
    if (adminCount <= 1) {
      return forbidden("不能删除最后一个超级管理员");
    }
  }

  await db.user.delete({ where: { id } });
  return NextResponse.json({ code: 0, message: "ok", data: { id } });
}

/** 宝塔等环境常拦截 PATCH/DELETE */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const url = new URL(request.url);
  if (url.searchParams.get("action") === "delete") {
    return DELETE(request, context);
  }
  return PATCH(request, context);
}
