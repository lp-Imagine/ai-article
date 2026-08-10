/**
 * 邮箱验证码：注册 / 重置密码共用。
 *
 * - 6 位数字验证码，10 分钟有效，单次使用
 * - 服务端只存 SHA-256 哈希，不存明文
 * - 同一邮箱 + 用途 60 秒内只能重发一次
 * - 连续输错 5 次后验证码作废
 */
import { createHash, randomInt } from "crypto";
import { db } from "@/lib/db";
import { isMailConfigured, sendMail } from "@/lib/mailer";

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODE_PURPOSES = ["register", "reset"] as const;
export type EmailCodePurpose = (typeof EMAIL_CODE_PURPOSES)[number];

export class EmailCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailCodeError";
  }
}

export function generateEmailCode(): string {
  return String(randomInt(100000, 1000000));
}

export function hashEmailCode(code: string): string {
  return createHash("sha256").update(`draftly-email-code:${code}`).digest("hex");
}

/**
 * 生成并向邮箱发送验证码。
 * 返回 null 表示发送成功但无需暴露给调用方；抛 EmailCodeError 表示被限流。
 */
export async function sendEmailCode(options: {
  email: string;
  purpose: EmailCodePurpose;
  userId?: string | null;
}): Promise<void> {
  const email = options.email.trim().toLowerCase();
  const now = Date.now();

  const recent = await db.emailVerificationCode.findFirst({
    where: {
      email,
      purpose: options.purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent && now - recent.createdAt.getTime() < EMAIL_CODE_RESEND_COOLDOWN_MS) {
    throw new EmailCodeError("发送过于频繁，请 60 秒后再试");
  }

  // 使该邮箱 + 用途的旧验证码全部失效
  await db.emailVerificationCode.updateMany({
    where: { email, purpose: options.purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = generateEmailCode();
  await db.emailVerificationCode.create({
    data: {
      email,
      purpose: options.purpose,
      codeHash: hashEmailCode(code),
      userId: options.userId ?? null,
      expiresAt: new Date(now + EMAIL_CODE_TTL_MS),
    },
  });

  if (isMailConfigured()) {
    try {
      await sendVerificationCodeMail(email, code, options.purpose);
      return;
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw error;
      }
      // 开发模式：真实发送失败（如授权码未填/网络不通）时退回打印，避免阻塞本地测试
      console.warn(
        "[dev-mail] 真实发送失败，改打印验证码：",
        error instanceof Error ? error.message : error,
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new EmailCodeError(
      "邮件服务未配置，请联系管理员在环境变量中设置 SMTP 或 RESEND_API_KEY",
    );
  }

  // 开发模式：打印验证码到服务端日志，方便本地调试
  console.log(
    `[dev-mail] ${options.purpose} code for ${email}: ${code}（开发模式，仅本地可见）`,
  );
}

/** 校验并消费验证码；错误 / 过期 / 超次数返回 null（校验失败会累计尝试次数） */
export async function verifyEmailCode(options: {
  email: string;
  purpose: EmailCodePurpose;
  code: string;
}): Promise<{ userId: string | null } | null> {
  const email = options.email.trim().toLowerCase();
  const row = await db.emailVerificationCode.findFirst({
    where: {
      email,
      purpose: options.purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  if (row.failedAttempts >= EMAIL_CODE_MAX_ATTEMPTS) return null;

  if (hashEmailCode(options.code.trim()) !== row.codeHash) {
    await db.emailVerificationCode.update({
      where: { id: row.id },
      data: { failedAttempts: { increment: 1 } },
    });
    return null;
  }

  await db.emailVerificationCode.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return { userId: row.userId };
}

async function sendVerificationCodeMail(
  to: string,
  code: string,
  purpose: EmailCodePurpose,
): Promise<void> {
  const isRegister = purpose === "register";
  const subject = isRegister ? "Draftly 注册验证码" : "Draftly 密码重置验证码";
  const text = [
    `你的验证码是：${code}`,
    "",
    `${isRegister ? "用于注册 Draftly 账号" : "用于重置 Draftly 密码"}，10 分钟内有效，请勿泄露给他人。`,
    "",
    "如果这不是你本人的操作，请忽略本邮件。",
  ].join("\n");
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2328;line-height:1.7">
  <h2 style="margin:0 0 16px;font-size:20px">${isRegister ? "Draftly 注册验证码" : "Draftly 密码重置验证码"}</h2>
  <p>你的验证码是：</p>
  <p style="margin:20px 0;padding:16px 20px;border-radius:10px;background:#f1f5f9;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center">${escapeHtml(code)}</p>
  <p style="font-size:13px;color:#6b7280">${isRegister ? "用于注册 Draftly 账号" : "用于重置 Draftly 密码"}，10 分钟内有效，请勿泄露给他人。</p>
  <p style="font-size:13px;color:#6b7280">如果这不是你本人的操作，请忽略本邮件。</p>
</div>`;

  await sendMail({ to, subject, text, html });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
