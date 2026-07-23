import { NextResponse } from "next/server";
import { requireUser, withAuthUserConfig } from "@/lib/api-auth";
import { getImageEndpointConfig } from "@/lib/image-gen";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  return withAuthUserConfig(user, async () => {
    const { baseUrl, model, apiKey } = getImageEndpointConfig();

    if (!apiKey) {
      return NextResponse.json({
        code: 0,
        message: "missing IMAGE_API_KEY",
        data: {
          configured: false,
          baseUrl,
          model,
          error: "在 /settings 填入图片 API Key（或复用文本 Key）后再试",
        },
      });
    }

    try {
      const res = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt: "test",
          n: 1,
          size: "1920x1920",
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        const hint =
          res.status === 404
            ? "端点不存在：请确认图片 Base URL 支持 /images/generations（不要填纯文本模型地址）"
            : undefined;
        return NextResponse.json({
          code: 0,
          message: "ping-image failed",
          data: {
            configured: true,
            baseUrl,
            model,
            httpStatus: res.status,
            error: body.slice(0, 200) || hint || `HTTP ${res.status}`,
            hint,
          },
        });
      }

      return NextResponse.json({
        code: 0,
        message: "ok",
        data: {
          configured: true,
          baseUrl,
          model,
          httpStatus: 200,
          note: "图片模型端点已连通",
        },
      });
    } catch (err) {
      return NextResponse.json({
        code: 0,
        message: "ping-image error",
        data: {
          configured: true,
          baseUrl,
          model,
          error: err instanceof Error ? err.message : "unknown",
        },
      });
    }
  });
}
