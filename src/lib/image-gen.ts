import { getEnvValue } from "@/lib/config-bridge";

const DEFAULT_IMAGE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_IMAGE_MODEL = "qwen-image-2.0";

function readConfig(key: string, fallback: string): string {
  const value = getEnvValue(key) ?? process.env[key];
  return value && value.trim() ? value : fallback;
}

function getImageApiKey(): string | undefined {
  return (
    getEnvValue("IMAGE_API_KEY") ??
    getEnvValue("AI_API_KEY") ??
    process.env.IMAGE_API_KEY ??
    process.env.AI_API_KEY ??
    undefined
  );
}

/**
 * 图片 Base URL 不得回退到文本 AI_BASE_URL：
 * DeepSeek / 多数纯文本网关没有 /images/generations，会直接 404。
 */
export function getImageEndpointConfig() {
  const baseUrl = readConfig("IMAGE_BASE_URL", DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, "");
  const model = readConfig("IMAGE_MODEL_NAME", DEFAULT_IMAGE_MODEL);
  const apiKey = getImageApiKey();
  return { baseUrl, model, apiKey };
}

function formatImageHttpError(status: number, body: string, baseUrl: string, model: string) {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 180);
  const hint =
    status === 404
      ? `请到设置单独填写「图片 API Base URL」与「图片模型」（勿用纯文本接口）。当前：${baseUrl} / ${model}`
      : `当前：${baseUrl} / ${model}`;
  return `image generation failed: ${status}${snippet ? ` ${snippet}` : ""}。${hint}`;
}

export async function generateCoverImage(
  prompt: string,
): Promise<{ url: string; source: "ai" | "placeholder" }> {
  const { baseUrl, model, apiKey } = getImageEndpointConfig();

  if (!apiKey) {
    return {
      url: `https://placehold.co/1200x630/${encodeURIComponent("F6F1E8")}/${encodeURIComponent("121212")}?text=${encodeURIComponent(prompt.slice(0, 24))}`,
      source: "placeholder",
    };
  }

  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "2560x1440",
      watermark: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(formatImageHttpError(res.status, err, baseUrl, model));
  }

  const json = (await res.json()) as { data: { url: string }[] };
  return { url: json.data[0]?.url ?? "", source: "ai" };
}

export async function downloadToBuffer(url: string): Promise<Buffer | null> {
  if (!url || url.startsWith("https://placehold.co")) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** 生成文章章节穿插配图（正方形 1:1，满足豆包最小像素要求） */
export async function generateSectionImage(
  prompt: string,
): Promise<{ url: string; source: "ai" | "placeholder" }> {
  const { baseUrl, model, apiKey } = getImageEndpointConfig();

  if (!apiKey) {
    return {
      url: `https://placehold.co/1920x1920/${encodeURIComponent("F6F1E8")}/${encodeURIComponent("121212")}?text=${encodeURIComponent(prompt.slice(0, 24))}`,
      source: "placeholder",
    };
  }

  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "2560x1440",
      watermark: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      formatImageHttpError(res.status, err, baseUrl, model).replace(
        "image generation failed",
        "section image failed",
      ),
    );
  }

  const json = (await res.json()) as { data: { url: string }[] };
  return { url: json.data[0]?.url ?? "", source: "ai" };
}
