import { NextResponse } from "next/server";
import { getEnvValue } from "@/lib/config-bridge";
import { requireUser, withAuthUserConfig } from "@/lib/api-auth";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  return withAuthUserConfig(user, async () => {
    const apiKey = getEnvValue("AI_API_KEY") ?? process.env.AI_API_KEY;
    const baseUrl =
      getEnvValue("AI_BASE_URL") || process.env.AI_BASE_URL || "https://api.openai.com/v1";
    const model =
      getEnvValue("TEXT_MODEL_NAME") || process.env.TEXT_MODEL_NAME || "gpt-4o-mini";

    if (!apiKey) {
      return NextResponse.json({
        code: 0,
        message: "missing AI_API_KEY",
        data: {
          configured: false,
          baseUrl,
          model,
          error: "在 /settings 填入 AI_API_KEY 后再试",
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
          note: "已成功连到模型端点",
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
  });
}
