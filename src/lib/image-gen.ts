import { getEnvValue } from "@/lib/config-bridge";

function readConfig(key: string, fallback: string): string {
  const value = getEnvValue(key) ?? process.env[key];
  return value && value.trim() ? value : fallback;
}

export async function generateCoverImage(
  prompt: string,
): Promise<{ url: string; source: "ai" | "placeholder" }> {
  const apiKey =
    getEnvValue("IMAGE_API_KEY") ??
    getEnvValue("AI_API_KEY") ??
    process.env.AI_API_KEY;

  if (!apiKey) {
    return {
      url: `https://placehold.co/1200x630/${encodeURIComponent("F6F1E8")}/${encodeURIComponent("121212")}?text=${encodeURIComponent(prompt.slice(0, 24))}`,
      source: "placeholder",
    };
  }

  const baseUrl = readConfig("IMAGE_BASE_URL", readConfig("AI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"));
  const model = readConfig("IMAGE_MODEL_NAME", "qwen-image-2.0");

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
    throw new Error(`image generation failed: ${res.status} ${err.slice(0, 200)}`);
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
  const apiKey =
    getEnvValue("IMAGE_API_KEY") ??
    getEnvValue("AI_API_KEY") ??
    process.env.AI_API_KEY;

  if (!apiKey) {
    return {
      url: `https://placehold.co/1920x1920/${encodeURIComponent("F6F1E8")}/${encodeURIComponent("121212")}?text=${encodeURIComponent(prompt.slice(0, 24))}`,
      source: "placeholder",
    };
  }

  const baseUrl = readConfig("IMAGE_BASE_URL", readConfig("AI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"));
  const model = readConfig("IMAGE_MODEL_NAME", "qwen-image-2.0");

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
    throw new Error(`section image failed: ${res.status} ${err.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data: { url: string }[] };
  return { url: json.data[0]?.url ?? "", source: "ai" };
}