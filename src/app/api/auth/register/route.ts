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
import {
  EmailCodeError,
  sendEmailCode,
  verifyEmailCode,
} from "@/lib/email-code";

const baseSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, "用户名仅支持字母、数字、下划线或中文"),
  email: z.string().trim().email("请输入有效的邮箱").max(200, "邮箱过长"),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码过长"),
  displayName: z.string().trim().max(40).optional(),
});

const sendCodeSchema = baseSchema.pick({ username: true, email: true });
const registerSchema = baseSchema.extend({
  code: z.string().regex(/^\d{6}$/, "请输入 6 位验证码"),
});

async function ensureEmailAvailable(username: string, email: string) {
  const exists = await db.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (exists) {
    throw new Error("用户名或邮箱已被占用");
  }
}

async function sendRegisterCode(request: Request) {
  await ensureBootstrapAdmin();
  const input = sendCodeSchema.parse(await request.json());
  const email = input.email.toLowerCase();

  await ensureEmailAvailable(input.username, email);
  await sendEmailCode({ email, purpose: "register" });
  return NextResponse.json({
    code: 0,
    message: "验证码已发送到邮箱，10 分钟内有效",
    data: null,
  });
}

export async function POST(request: Request) {
  try {
    await ensureBootstrapAdmin();
    const action = new URL(request.url).searchParams.get("action");
    if (action === "send-code") {
      return await sendRegisterCode(request);
    }

    const input = registerSchema.parse(await request.json());
    const email = input.email.toLowerCase();

    const verified = await verifyEmailCode({
      email,
      purpose: "register",
      code: input.code,
    });
    if (!verified) {
      return NextResponse.json(
        { code: 1001, message: "验证码错误或已过期，请重新获取", data: null },
        { status: 400 },
      );
    }

    await ensureEmailAvailable(input.username, email);

    const user = await db.user.create({
      data: {
        username: input.username,
        email,
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
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    });
    response.cookies.set(
      sessionCookieOptions(token, SESSION_DAYS_REGISTER * 24 * 60 * 60),
    );
    return response;
  } catch (error) {
    if (error instanceof EmailCodeError) {
      return NextResponse.json(
        {
          code: 1000,
          message: error.message,
          data: null,
        },
        { status: 400 },
      );
    }
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
