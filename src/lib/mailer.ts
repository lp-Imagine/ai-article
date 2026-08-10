/**
 * 邮件发送（双通道：SMTP / Resend HTTP API）。
 *
 * MAIL_PROVIDER = "smtp" | "resend" | "auto"（默认 auto：
 *   配了 RESEND_API_KEY 用 resend，否则配了 SMTP_HOST 用 smtp）
 * SMTP_FROM 两种通道共用，发件人如 "Draftly <noreply@example.com>"
 *
 * SMTP 通道：
 *   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS
 * Resend 通道：
 *   RESEND_API_KEY（https://resend.com，发件域名需在 Resend 验证）
 */
import nodemailer from "nodemailer";

type MailProvider = "smtp" | "resend";

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const portRaw = Number(process.env.SMTP_PORT || "");
  const port = Number.isInteger(portRaw) && portRaw > 0 ? portRaw : 587;
  const secureFlag = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure =
    secureFlag === "1" || secureFlag === "true" || secureFlag === "yes"
      ? true
      : secureFlag === "0" || secureFlag === "false" || secureFlag === "no"
        ? false
        : port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS || "";

  return {
    host: host || "",
    port,
    secure,
    user,
    pass,
    from: from || "",
  };
}

function resendConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY?.trim() || "",
    from: process.env.SMTP_FROM?.trim() || "",
  };
}

/** 当前生效的邮件通道；未配置任何通道时返回 null */
export function mailProvider(): MailProvider | null {
  const mode = (process.env.MAIL_PROVIDER || "auto").trim().toLowerCase();
  if (mode === "smtp") return "smtp";
  if (mode === "resend") return "resend";
  // auto：优先 Resend，其次 SMTP
  if (resendConfig().apiKey) return "resend";
  if (smtpConfig().host) return "smtp";
  return null;
}

export function isMailConfigured(): boolean {
  return Boolean(mailProvider());
}

async function sendViaSmtp(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const cfg = smtpConfig();
  if (!cfg.host || !cfg.from) {
    throw new Error("邮件服务未配置（缺少 SMTP_HOST / SMTP_FROM）");
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
  });

  await transporter.sendMail({
    from: cfg.from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });
}

async function sendViaResend(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const cfg = resendConfig();
  if (!cfg.apiKey || !cfg.from) {
    throw new Error("邮件服务未配置（缺少 RESEND_API_KEY / SMTP_FROM）");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: cfg.from,
      to: [options.to],
      subject: options.subject,
      text: options.text,
      html: options.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend 发送失败（${res.status}）: ${body.slice(0, 200)}`);
  }
}

export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const provider = mailProvider();
  if (!provider) {
    throw new Error(
      "邮件服务未配置：请设置 MAIL_PROVIDER 对应的 SMTP 或 RESEND_API_KEY",
    );
  }
  if (provider === "resend") {
    await sendViaResend(options);
  } else {
    await sendViaSmtp(options);
  }
}
