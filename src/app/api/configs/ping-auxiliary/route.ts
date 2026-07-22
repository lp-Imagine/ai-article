import { NextResponse } from "next/server";
import { getLLMCredentialsForRole } from "@/lib/ai";
import { getEnvValue, syncConfigsToEnv } from "@/lib/config-bridge";

export async function GET() {
  await syncConfigsToEnv(true);

  const { model, baseUrl, apiKey } = getLLMCredentialsForRole("summary");
  const primaryModel = getEnvValue("TEXT_MODEL_NAME") || "gpt-4o-mini";

  if (!model || model === primaryModel) {
    return NextResponse.json({
      code: 0,
      message: "auxiliary not configured",
      data: {
        configured: false,
        baseUrl,
        model,
        error: "请填写「文本模型（辅助）」后再验证；留空时辅助任务会使用主模型",
      },
    });
  }

  if (!apiKey) {
    return NextResponse.json({
      code: 0,
      message: "missing api key",
      data: {
        configured: false,
        baseUrl,
        model,
        error: "请填写辅助 API Key，或确保主 AI API Key 已配置",
      },
    });
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({
        code: 0,
        message: "ping failed",
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
        note: "已成功连到辅助模型端点",
      },
    });
  } catch (err) {
    return NextResponse.json({
      code: 0,
      message: "ping error",
      data: {
        configured: true,
        baseUrl,
        model,
        error: err instanceof Error ? err.message : "unknown",
      },
    });
  }
}
