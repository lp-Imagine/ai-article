import type { ApiResponse } from "@/types/article";

export async function readApiResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
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

  return (await res.json()) as ApiResponse<T>;
}
