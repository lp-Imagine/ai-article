import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  createSession,
  ensureBootstrapAdmin,
  SESSION_DAYS_REGISTER,
  sessionCookieOptions,
} from "@/lib/auth";
import { hashPassword } from "@/lib/password";

const schema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, "用户名仅支持字母、数字、下划线或中文"),
  password: z.string().min(6, "密码至少 6 位").max(72, "密码过长"),
  displayName: z.string().trim().max(40).optional(),
});

export async function POST(request: Request) {
  try {
    await ensureBootstrapAdmin();
    const input = schema.parse(await request.json());

    const exists = await db.user.findUnique({ where: { username: input.username } });
    if (exists) {
      return NextResponse.json(
        { code: 1001, message: "用户名已被占用", data: null },
        { status: 400 },
      );
    }

    const user = await db.user.create({
      data: {
        username: input.username,
        passwordHash: hashPassword(input.password),
        displayName: input.displayName || input.username,
        role: "USER",
      },
    });

    const token = await createSession(user.id, SESSION_DAYS_REGISTER);
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
    response.cookies.set(
      sessionCookieOptions(token, SESSION_DAYS_REGISTER * 24 * 60 * 60),
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "注册失败",
        data: null,
      },
      { status: 400 },
    );
  }
}
