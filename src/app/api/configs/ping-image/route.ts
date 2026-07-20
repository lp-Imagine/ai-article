import { NextResponse } from "next/server";
import { getEnvValue, syncConfigsToEnv } from "@/lib/config-bridge";

export async function GET() {
  await syncConfigsToEnv(true);

  const apiKey =
    getEnvValue("IMAGE_API_KEY") ?? getEnvValue("AI_API_KEY") ?? process.env.AI_API_KEY;
  const baseUrl =
    getEnvValue("IMAGE_BASE_URL") ||
    getEnvValue("AI_BASE_URL") ||
    process.env.AI_BASE_URL ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model =
    getEnvValue("IMAGE_MODEL_NAME") || process.env.IMAGE_MODEL_NAME || "qwen-image-2.0";

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
      return NextResponse.json({
        code: 0,
        message: "ping-image failed",
        data: {
          configured: true,
          baseUrl,
          model,
          httpStatus: res.status,
          error: body.slice(0, 200),
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
}