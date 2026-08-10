import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { destroyUserSessions, ensureBootstrapAdmin } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { verifyEmailCode } from "@/lib/email-code";

const schema = z.object({
  account: z
    .string()
    .trim()
    .min(1, "请输入用户名或邮箱")
    .max(200, "输入过长"),
  code: z.string().regex(/^\d{6}$/, "请输入 6 位验证码"),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码过长"),
});

export async function POST(request: Request) {
  try {
    await ensureBootstrapAdmin();
    const input = schema.parse(await request.json());
    const rawAccount = input.account.trim();
    const email = rawAccount.toLowerCase();

    const user = await db.user.findFirst({
      where: { OR: [{ email }, { username: rawAccount }] },
    });
    if (!user?.email) {
      // 与验证码错误同文案，避免探测账号是否存在
      return NextResponse.json(
        { code: 1001, message: "验证码错误或已过期，请重新获取", data: null },
        { status: 400 },
      );
    }
    if (user.disabled) {
      return NextResponse.json(
        { code: 1002, message: "账号已被禁用，请联系管理员", data: null },
        { status: 403 },
      );
    }

    const verified = await verifyEmailCode({
      email: user.email,
      purpose: "reset",
      code: input.code,
    });
    if (!verified) {
      return NextResponse.json(
        { code: 1001, message: "验证码错误或已过期，请重新获取", data: null },
        { status: 400 },
      );
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(input.password) },
    });
    // 重置后让所有旧会话失效
    await destroyUserSessions(user.id);

    return NextResponse.json({
      code: 0,
      message: "密码已重置，请使用新密码登录",
      data: null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "重置失败，请稍后重试",
        data: null,
      },
      { status: 400 },
    );
  }
}
