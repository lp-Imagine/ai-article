import { NextResponse } from "next/server";
import { requireUser, withAuthUserConfig } from "@/lib/api-auth";
import { isBlogSyncConfigured } from "@/lib/blog-sync";

// 返回当前登录用户是否配置了博客同步（按用户隔离）。
// 仅返回布尔值，绝不回显 token / repo 等敏感信息。
export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  return withAuthUserConfig(user, async () => {
    return NextResponse.json({
      code: 0,
      message: "ok",
      data: { configured: isBlogSyncConfigured() },
    });
  });
}
