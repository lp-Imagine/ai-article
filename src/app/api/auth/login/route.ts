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
import { getClientIp, hitRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
  remember: z.boolean().optional(),
});

function tooManyAttempts(retryAfterMs: number) {
  return NextResponse.json(
    {
      code: 1002,
      message: `登录尝试过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`,
      data: null,
    },
    { status: 429 },
  );
}

export async function POST(request: Request) {
  try {
    await ensureBootstrapAdmin();

    // 双层限流抵御撞库：同 IP 每分钟 20 次（容忍办公网 NAT 共享出口），
    // 同账号 10 分钟 10 次（真正卡住针对单个账号的密码爆破）。
    const ipLimit = hitRateLimit({
      key: `login:ip:${getClientIp(request)}`,
      windowMs: 60_000,
      max: 20,
    });
    if (!ipLimit.ok) return tooManyAttempts(ipLimit.retryAfterMs);

    const input = schema.parse(await request.json());

    const accountLimit = hitRateLimit({
      key: `login:account:${input.username.toLowerCase()}`,
      windowMs: 10 * 60_000,
      max: 10,
    });
    if (!accountLimit.ok) return tooManyAttempts(accountLimit.retryAfterMs);

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
