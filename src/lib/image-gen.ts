import { getEnvValue } from "@/lib/config-bridge";
import { assertSafeImportUrl } from "@/lib/import-content";
import {
  fetchWithTimeout,
  isRetryableHttpStatus,
  isTransientNetworkError,
  withRetry,
} from "@/lib/retry";

const DEFAULT_IMAGE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_IMAGE_MODEL = "qwen-image-2.0";
const DEFAULT_IMAGE_TIMEOUT_MS = 180_000;

/** 各模型单边像素上限（Qwen-Image 等为 2048；超出会被静默降分辨率） */
const QWEN_MAX_SIDE = 2048;
const QWEN_MAX_PIXELS = QWEN_MAX_SIDE * QWEN_MAX_SIDE;

/** 封面 16:9，在 Qwen 限制内尽量高 */
const DEFAULT_COVER_SIZE = "2048x1152";
/** 章节配图改横版 16:9，贴合三格流程、正文里也不占过高 */
const DEFAULT_INLINE_SIZE = "2048x1152";

export type ImageKind = "cover" | "inline";

/** HTTP 状态可重试时打上标记，供 withRetry 判定 */
class RetryableImageError extends Error {
  readonly retryable = true;
}

function getImageTimeoutMs(): number {
  const raw = Number(process.env.IMAGE_REQUEST_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_IMAGE_TIMEOUT_MS;
}

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

function isQwenImageModel(model: string): boolean {
  return /qwen-image/i.test(model);
}

function isDalle3Model(model: string): boolean {
  return /dall-e-3/i.test(model);
}

/** 解析 2048x1152 / 2048*1152 */
export function parseImageSize(size: string): { width: number; height: number } | null {
  const normalized = size.trim().replace(/\*/g, "x");
  const match = normalized.match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) {
    return null;
  }
  return { width, height };
}

/** 将尺寸限制在模型允许范围内，并对齐 16 像素（Qwen 输出惯例） */
export function clampImageSize(
  width: number,
  height: number,
  opts?: { maxSide?: number; maxPixels?: number },
): { width: number; height: number } {
  const maxSide = opts?.maxSide ?? QWEN_MAX_SIDE;
  const maxPixels = opts?.maxPixels ?? QWEN_MAX_PIXELS;

  let w = width;
  let h = height;

  if (w > maxSide) {
    h = Math.round((h * maxSide) / w);
    w = maxSide;
  }
  if (h > maxSide) {
    w = Math.round((w * maxSide) / h);
    h = maxSide;
  }
  while (w * h > maxPixels) {
    w = Math.max(512, Math.floor(w * 0.92));
    h = Math.max(512, Math.floor(h * 0.92));
  }

  w = Math.max(512, Math.floor(w / 16) * 16);
  h = Math.max(512, Math.floor(h / 16) * 16);
  return { width: w, height: h };
}

function formatSizeString(width: number, height: number, separator: "x" | "*"): string {
  return `${width}${separator}${height}`;
}

/** 按模型与用途选择生成尺寸（可通过 IMAGE_COVER_SIZE / IMAGE_INLINE_SIZE 覆盖） */
export function resolveImageSize(kind: ImageKind, model: string): string {
  const profile = getModelImageProfile(model);
  const envKey = kind === "cover" ? "IMAGE_COVER_SIZE" : "IMAGE_INLINE_SIZE";
  const configured = readConfig(envKey, "");

  const parsed = configured ? parseImageSize(configured) : null;
  const base = parsed ?? (kind === "cover" ? profile.cover : profile.inline);

  const { width, height } = clampImageSize(base.width, base.height, {
    maxSide: profile.maxSide,
    maxPixels: profile.maxPixels,
  });

  return formatSizeString(width, height, profile.sizeSeparator);
}

type ModelImageProfile = {
  cover: { width: number; height: number };
  inline: { width: number; height: number };
  maxSide: number;
  maxPixels: number;
  sizeSeparator: "x" | "*";
};

function isSeedreamModel(model: string): boolean {
  return /seedream|doubao/i.test(model);
}

/** 各模型家族的默认尺寸与上限（画质主要由 size 决定，不是 quality 参数） */
export function getModelImageProfile(model: string): ModelImageProfile {
  if (isQwenImageModel(model)) {
    return {
      cover: { width: 2048, height: 1152 },
      inline: { width: 2048, height: 1152 },
      maxSide: QWEN_MAX_SIDE,
      maxPixels: QWEN_MAX_PIXELS,
      sizeSeparator: "*",
    };
  }

  if (isDalle3Model(model)) {
    return {
      cover: { width: 1792, height: 1024 },
      inline: { width: 1792, height: 1024 },
      maxSide: 1792,
      maxPixels: 1792 * 1024,
      sizeSeparator: "x",
    };
  }

  if (isSeedreamModel(model)) {
    // 豆包 Seedream：封面/章节配图统一 16:9，避免方图在正文里过高过大
    // 4.x 官方 2K 16:9 推荐 2848x1600；5.x 像素上限约 4M，用 2560x1440
    const seedream5 = /seedream-5/i.test(model);
    const landscape = seedream5
      ? { width: 2560, height: 1440 }
      : { width: 2848, height: 1600 };
    return {
      cover: landscape,
      inline: landscape,
      maxSide: 4096,
      maxPixels: seedream5 ? 4_194_304 : 16_777_216,
      sizeSeparator: "x",
    };
  }

  return {
    cover: parseImageSize(DEFAULT_COVER_SIZE)!,
    inline: parseImageSize(DEFAULT_INLINE_SIZE)!,
    maxSide: QWEN_MAX_SIDE,
    maxPixels: QWEN_MAX_PIXELS,
    sizeSeparator: "x",
  };
}

function buildGenerationPayload(prompt: string, model: string, kind: ImageKind): Record<string, unknown> {
  const size = resolveImageSize(kind, model);
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    size,
    watermark: false,
  };

  if (isQwenImageModel(model)) {
    body.prompt_extend = true;
    body.negative_prompt =
      "low resolution, blurry, worst quality, jpeg artifacts, distorted, watermark, oversaturated";
  } else if (isDalle3Model(model)) {
    const quality = readConfig("IMAGE_QUALITY", "hd");
    if (quality === "hd" || quality === "standard") {
      body.quality = quality;
    }
  } else {
    const quality = readConfig("IMAGE_QUALITY", "");
    if (quality === "hd" || quality === "standard") {
      body.quality = quality;
    }
  }

  return body;
}

function formatImageHttpError(status: number, body: string, baseUrl: string, model: string) {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 180);
  const hint =
    status === 404
      ? `请到设置单独填写「图片 API Base URL」与「图片模型」（勿用纯文本接口）。当前：${baseUrl} / ${model}`
      : `当前：${baseUrl} / ${model}`;
  return `image generation failed: ${status}${snippet ? ` ${snippet}` : ""}。${hint}`;
}

/** 调用图片接口：带超时与瞬时错误重试，避免请求挂死拖垮整个任务 */
async function requestImageUrl(
  prompt: string,
  label: string,
  kind: ImageKind,
): Promise<string> {
  const { baseUrl, model, apiKey } = getImageEndpointConfig();
  const timeoutMs = getImageTimeoutMs();
  const payload = buildGenerationPayload(prompt, model, kind);

  return withRetry(
    async () => {
      const res = await fetchWithTimeout(
        `${baseUrl}/images/generations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        },
        timeoutMs,
        label,
      );

      if (!res.ok) {
        const body = await res.text();
        const message = formatImageHttpError(res.status, body, baseUrl, model).replace(
          "image generation failed",
          label,
        );
        throw isRetryableHttpStatus(res.status)
          ? new RetryableImageError(message)
          : new Error(message);
      }

      const json = (await res.json()) as { data: { url: string }[] };
      const url = json.data[0]?.url ?? "";
      if (!url) throw new RetryableImageError(`${label}：接口未返回图片地址`);
      return url;
    },
    {
      attempts: 3,
      baseDelayMs: 1500,
      shouldRetry: (error) =>
        error instanceof RetryableImageError || isTransientNetworkError(error),
      onRetry: (error, attempt) =>
        console.warn(
          `[image-gen] ${label} attempt ${attempt + 1} failed, retrying:`,
          error instanceof Error ? error.message : error,
        ),
    },
  );
}

export async function generateCoverImage(
  prompt: string,
): Promise<{ url: string; source: "ai" | "placeholder" }> {
  const { apiKey } = getImageEndpointConfig();

  if (!apiKey) {
    return {
      url: `https://placehold.co/1200x630/${encodeURIComponent("0A0F1F")}/${encodeURIComponent("8AB4F8")}?text=${encodeURIComponent(prompt.slice(0, 24))}`,
      source: "placeholder",
    };
  }

  return { url: await requestImageUrl(prompt, "image generation failed", "cover"), source: "ai" };
}

export async function downloadToBuffer(url: string): Promise<Buffer | null> {
  if (!url || url.startsWith("https://placehold.co")) return null;
  try {
    assertSafeImportUrl(url);
  } catch {
    return null;
  }
  const res = await fetchWithTimeout(url, {}, getImageTimeoutMs(), "图片下载");
  if (!res.ok) return null;
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** 生成文章章节穿插配图（正方形 1:1，满足豆包 / Qwen 最高像素要求） */
export async function generateSectionImage(
  prompt: string,
): Promise<{ url: string; source: "ai" | "placeholder" }> {
  const { apiKey } = getImageEndpointConfig();

  if (!apiKey) {
    return {
      url: `https://placehold.co/1920x1920/${encodeURIComponent("0A0F1F")}/${encodeURIComponent("8AB4F8")}?text=${encodeURIComponent(prompt.slice(0, 24))}`,
      source: "placeholder",
    };
  }

  return { url: await requestImageUrl(prompt, "section image failed", "inline"), source: "ai" };
}
