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

function formatImageHttpError(status: number, body: string, baseUrl: string, model: string) {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 180);
  const hint =
    status === 404
      ? `请到设置单独填写「图片 API Base URL」与「图片模型」（勿用纯文本接口）。当前：${baseUrl} / ${model}`
      : `当前：${baseUrl} / ${model}`;
  return `image generation failed: ${status}${snippet ? ` ${snippet}` : ""}。${hint}`;
}

/** 调用图片接口：带超时与瞬时错误重试，避免请求挂死拖垮整个任务 */
async function requestImageUrl(prompt: string, label: string): Promise<string> {
  const { baseUrl, model, apiKey } = getImageEndpointConfig();
  const timeoutMs = getImageTimeoutMs();

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
          body: JSON.stringify({
            model,
            prompt,
            n: 1,
            size: "2560x1440",
            watermark: false,
          }),
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
        // 限流/网关抖动值得重试；404、401 等配置类错误立即失败
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

  return { url: await requestImageUrl(prompt, "image generation failed"), source: "ai" };
}

export async function downloadToBuffer(url: string): Promise<Buffer | null> {
  if (!url || url.startsWith("https://placehold.co")) return null;
  // SSRF 防护：只允许公开 http(s) 图片。封面 URL 来自用户可写入的文章字段，
  // 若不校验，服务端可能被诱导去抓内网/云元数据地址。
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

/** 生成文章章节穿插配图（正方形 1:1，满足豆包最小像素要求） */
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

  return { url: await requestImageUrl(prompt, "section image failed"), source: "ai" };
}
