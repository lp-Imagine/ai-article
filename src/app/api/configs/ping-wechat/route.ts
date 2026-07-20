import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/wechat";
import { syncConfigsToEnv, getEnvValue } from "@/lib/config-bridge";

export async function GET() {
  await syncConfigsToEnv(true);

  const appId = getEnvValue("WECHAT_APP_ID") ?? process.env.WECHAT_APP_ID;
  const appSecret = getEnvValue("WECHAT_APP_SECRET") ?? process.env.WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    return NextResponse.json({
      code: 0,
      message: "missing WeChat config",
      data: {
        configured: false,
        error: "请先填写微信公众号 App ID 和 App Secret",
      },
    });
  }

  try {
    const token = await getAccessToken();
    return NextResponse.json({
      code: 0,
      message: "ok",
      data: {
        configured: true,
        note: `微信 access_token 获取成功 (${token.slice(0, 8)}...)`,
      },
    });
  } catch (err) {
    return NextResponse.json({
      code: 0,
      message: "wechat ping failed",
      data: {
        configured: true,
        error: err instanceof Error ? err.message : "微信接口调用失败",
      },
    });
  }
}
