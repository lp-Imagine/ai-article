import { NextResponse } from "next/server";
import { requireUser, withAuthUserConfig } from "@/lib/api-auth";
import { isBlogSyncConfigured } from "@/lib/blog-sync";

/**
 * 博客同步能力：仅超级管理员可用。
 * configured = 管理员且已填写 Token；allowed = 是否为超管。
 */
export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const allowed = user.role === "SUPER_ADMIN";
  if (!allowed) {
    return NextResponse.json({
      code: 0,
      message: "ok",
      data: { configured: false, allowed: false },
    });
  }

  return withAuthUserConfig(user, async () => {
    return NextResponse.json({
      code: 0,
      message: "ok",
      data: { configured: isBlogSyncConfigured(), allowed: true },
    });
  });
}
