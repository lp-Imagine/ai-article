import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { SESSION_COOKIE } from "@/lib/auth-constants";

export { SESSION_COOKIE };
const SESSION_DAYS = 30;
export const SESSION_DAYS_REMEMBER = 90;
export const SESSION_DAYS_SHORT = 7;

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
      const username = (process.env.SUPER_ADMIN_USERNAME || "admin").trim();
      const password = process.env.SUPER_ADMIN_PASSWORD || "admin123";
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

export async function createSession(userId: string, days = SESSION_DAYS): Promise<string> {
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

export function sessionCookieOptions(token: string, maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
