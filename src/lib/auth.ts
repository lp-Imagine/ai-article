import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { SESSION_COOKIE } from "@/lib/auth-constants";

export { SESSION_COOKIE };
/** 注册后自动登录 */
export const SESSION_DAYS_REGISTER = 7;
/** 勾选「记住密码」 */
export const SESSION_DAYS_REMEMBER = 30;
/** 普通登录（未勾选记住密码）= 24 小时 */
export const SESSION_DAYS_SHORT = 1;

export type SessionUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: UserRole;
};

let bootstrapPromise: Promise<void> | null = null;

export async function ensureBootstrapAdmin() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      if (typeof db.user?.findFirst !== "function") {
        throw new Error(
          "数据库客户端未就绪（user.findFirst 不可用）。请执行 npx prisma generate 并重启服务；确认 DATABASE_URL 为 postgresql://...",
        );
      }

      const username = (process.env.SUPER_ADMIN_USERNAME || "admin").trim();
      const isProd = process.env.NODE_ENV === "production";
      let password = process.env.SUPER_ADMIN_PASSWORD?.trim();
      if (!password) {
        if (isProd) {
          // 生产禁止使用公开文档里的默认口令；仅在本次创建/重置时生效
          password = randomBytes(18).toString("base64url");
          console.warn(
            `[auth] 未设置 SUPER_ADMIN_PASSWORD，已为超管「${username}」生成随机密码（仅本次启动日志可见一次）。请尽快在环境变量中设置 SUPER_ADMIN_PASSWORD，必要时配合 SUPER_ADMIN_RESET=1 写入数据库。密码：${password}`,
          );
        } else {
          password = "admin123";
        }
      }
      const passwordHash = hashPassword(password);

      let admin = await db.user.findFirst({
        where: { role: "SUPER_ADMIN" },
        orderBy: { createdAt: "asc" },
      });

      if (!admin) {
        admin = await db.user.upsert({
          where: { username },
          create: {
            username,
            passwordHash,
            displayName: "超级管理员",
            role: "SUPER_ADMIN",
          },
          update: {
            passwordHash,
            role: "SUPER_ADMIN",
            disabled: false,
          },
        });
      } else if (
        admin.passwordHash.startsWith("00000000") ||
        process.env.SUPER_ADMIN_RESET === "1"
      ) {
        // 修复迁移占位哈希，或显式重置超管密码
        admin = await db.user.update({
          where: { id: admin.id },
          data: {
            passwordHash,
            disabled: false,
          },
        });
      }
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  await bootstrapPromise;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(userId: string, days = SESSION_DAYS_REGISTER): Promise<string> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await db.session.create({
    data: { token, userId, expiresAt },
  });
  return token;
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await db.session.deleteMany({ where: { token } });
}

export async function destroyUserSessions(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  await ensureBootstrapAdmin();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          disabled: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.disabled) return null;

  return {
    id: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    role: session.user.role,
  };
}

export function sessionCookieSecure() {
  const flag = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  // 默认不设 Secure：HTTP（IP / 宝塔反代未开 HTTPS）下浏览器会丢弃 Secure Cookie，导致登录后无法跳转
  return false;
}

export function sessionCookieOptions(
  token: string,
  maxAgeSeconds = SESSION_DAYS_REGISTER * 24 * 60 * 60,
) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: sessionCookieSecure(),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
