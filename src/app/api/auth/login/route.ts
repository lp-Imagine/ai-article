import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  createSession,
  ensureBootstrapAdmin,
  SESSION_DAYS_REMEMBER,
  SESSION_DAYS_SHORT,
  sessionCookieOptions,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

const schema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
  remember: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    await ensureBootstrapAdmin();
    const input = schema.parse(await request.json());

    const user = await db.user.findUnique({ where: { username: input.username } });
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      return NextResponse.json(
        { code: 1001, message: "用户名或密码错误", data: null },
        { status: 401 },
      );
    }
    if (user.disabled) {
      return NextResponse.json(
        { code: 1002, message: "账号已被禁用，请联系管理员", data: null },
        { status: 403 },
      );
    }

    const days = input.remember ? SESSION_DAYS_REMEMBER : SESSION_DAYS_SHORT;
    const token = await createSession(user.id, days);
    const response = NextResponse.json({
      code: 0,
      message: "ok",
      data: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
    response.cookies.set(sessionCookieOptions(token, days * 24 * 60 * 60));
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "登录失败",
        data: null,
      },
      { status: 400 },
    );
  }
}
