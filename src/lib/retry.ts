/** 网络类瞬时错误判定与通用重试，供 LLM 与图片接口共用 */

const TRANSIENT_PATTERNS = [
  "other side closed",
  "terminated",
  "econnreset",
  "econnrefused",
  "enotfound",
  "epipe",
  "etimedout",
  "socket hang up",
  "broken pipe",
  "network",
];

function collectMessages(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const parts = [error.message];
  let cause: unknown = error.cause;
  // 依次展开 cause 链：undici 常把真实原因塞在 error.cause
  for (let depth = 0; depth < 3 && cause; depth++) {
    if (cause instanceof Error) {
      parts.push(cause.message);
      cause = cause.cause;
    } else if (typeof cause === "string") {
      parts.push(cause);
      break;
    } else {
      break;
    }
  }
  return parts.join(" ").toLowerCase();
}

export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const combined = collectMessages(error);
  if (!combined) return false;
  if (error.name === "AbortError" || combined.includes("aborted")) return true;
  if (combined.includes("fetch failed")) return true;
  if (combined.includes("请求超时")) return true;
  return TRANSIENT_PATTERNS.some((p) => combined.includes(p));
}

/** 上游过载/限流等可重试的 HTTP 状态 */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * 按指数退避重试。仅当 shouldRetry 判定为可重试时才继续，
 * 否则（鉴权、参数错误等）立即抛出，避免无谓等待。
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: {
    attempts?: number;
    baseDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
    onRetry?: (error: unknown, attempt: number) => void;
  },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 1000;
  const shouldRetry = opts?.shouldRetry ?? isTransientNetworkError;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !shouldRetry(error)) throw error;
      opts?.onRetry?.(error, attempt);
      await sleep(baseDelay * (attempt + 1));
    }
  }
  throw lastError;
}

/** 带超时的 fetch；超时抛出携带可读信息的 Error */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label}请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
