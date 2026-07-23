import type { ApiResponse } from "@/types/article";

export async function readApiResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";

  if (!text.trim()) {
    if (res.status === 502 || res.status === 504 || res.status === 408) {
      throw new Error(
        `请求超时或被网关中断 (HTTP ${res.status})。请确认 Nginx proxy_read_timeout ≥ 300s。`,
      );
    }
    throw new Error(
      `服务器返回空响应 (HTTP ${res.status || "?"})。若在宝塔部署，请检查是否拦截了 PUT/DELETE；配置保存请使用 POST。`,
    );
  }

  if (!contentType.includes("application/json")) {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 150);
    if (res.status === 502 || res.status === 504 || res.status === 408) {
      throw new Error(
        `请求超时或被网关中断 (HTTP ${res.status})。长任务应为异步入队；请确认 Nginx proxy_read_timeout ≥ 300s，并刷新页面查看任务是否已在后台完成。`,
      );
    }
    throw new Error(
      snippet
        ? `服务器返回异常 (HTTP ${res.status})：${snippet}`
        : `服务器返回异常 (HTTP ${res.status})，响应不是 JSON`,
    );
  }

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new Error(`服务器返回了无法解析的 JSON (HTTP ${res.status})`);
  }
}
