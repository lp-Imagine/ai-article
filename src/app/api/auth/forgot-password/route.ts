import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ensureBootstrapAdmin } from "@/lib/auth";
import { EmailCodeError, sendEmailCode } from "@/lib/email-code";
import { getClientIp, hitRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  account: z
    .string()
    .trim()
    .min(1, "请输入用户名或邮箱")
    .max(200, "输入过长"),
});

export async function POST(request: Request) {
  try {
    await ensureBootstrapAdmin();
    const ip = getClientIp(request);

    // 同 IP 每分钟 3 次，避免重置密码接口被用来轰炸 / 探测账号存在
    const ipLimit = hitRateLimit({
      key: `reset:ip:${ip}`,
      windowMs: 60_000,
      max: 3,
    });
    if (!ipLimit.ok) {
      return NextResponse.json(
        {
          code: 1002,
          message: `请求过于频繁，请 ${Math.ceil(ipLimit.retryAfterMs / 1000)} 秒后再试`,
          data: null,
        },
        { status: 429 },
      );
    }

    const input = schema.parse(await request.json());
    const rawAccount = input.account.trim();
    const email = rawAccount.toLowerCase();

    const user = await db.user.findFirst({
      where: {
        OR: [{ email }, { username: rawAccount }],
      },
    });

    // 账号不存在也返回同样的文案，避免泄露注册信息
    if (user?.email) {
      await sendEmailCode({
        email: user.email,
        purpose: "reset",
        userId: user.id,
      });
    }

    return NextResponse.json({
      code: 0,
      message: "如果该账号存在且已绑定邮箱，验证码已发送，请查收",
      data: null,
    });
  } catch (error) {
    if (error instanceof EmailCodeError) {
      return NextResponse.json(
        { code: 1000, message: error.message, data: null },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "发送失败，请稍后重试",
        data: null,
      },
      { status: 400 },
    );
  }
}
