import type { ApiResponse } from "@/types/article";

export async function readApiResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 150);

    if (res.status === 502 || res.status === 504 || res.status === 408) {
      throw new Error(
        `请求超时或被网关中断 (HTTP ${res.status})。AI 生成通常需要 30–60 秒，请将 Nginx/负载均衡的 proxy_read_timeout 设为 120s 以上后重试。`,
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
