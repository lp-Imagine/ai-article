import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { isSecretKey } from "@/lib/config-bridge";

/** 当 SecretKey 已配置但不在前端回显原值时使用；前端保存时会跳过该键。 */
export const SECRET_PLACEHOLDER = "********";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const configs = await db.appConfig.findMany({
      where: { userId: user.id },
      orderBy: { configKey: "asc" },
    });

    const map: Record<string, string> = {};
    for (const cfg of configs) {
      // SecretKey 不回显原值；用占位符表示「已配置但请重新输入以更新」。
      // 前端识别到 SECRET_PLACEHOLDER 时会在保存时跳过该键，避免覆盖已有 token。
      map[cfg.configKey] = isSecretKey(cfg.configKey)
        ? SECRET_PLACEHOLDER
        : cfg.configValue;
    }

    return NextResponse.json({
      code: 0,
      message: "ok",
      data: map,
    });
  } catch (err) {
    return NextResponse.json(
      {
        code: 500,
        message: err instanceof Error ? err.message : "加载配置失败",
        data: null,
      },
      { status: 500 },
    );
  }
}

async function saveConfigs(req: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { code: 400, message: "请求体无效", data: null },
        { status: 400 },
      );
    }

    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== "string") continue;
      // 占位符表示前端没有改这个 secret，跳过以免覆盖数据库原值
      if (value === SECRET_PLACEHOLDER) continue;
      await db.appConfig.upsert({
        where: {
          userId_configKey: { userId: user.id, configKey: key },
        },
        create: { userId: user.id, configKey: key, configValue: value },
        update: { configValue: value },
      });
    }

    return NextResponse.json({
      code: 0,
      message: "ok",
      data: null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        code: 500,
        message: err instanceof Error ? err.message : "保存配置失败",
        data: null,
      },
      { status: 500 },
    );
  }
}

/** 宝塔等环境常拦截 PUT，保存统一走 POST */
export async function POST(req: Request) {
  return saveConfigs(req);
}

/** @deprecated 兼容旧客户端；若网关拦截 PUT 请改用 POST */
export async function PUT(req: Request) {
  return saveConfigs(req);
}
