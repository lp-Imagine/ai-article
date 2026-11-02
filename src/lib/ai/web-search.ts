import { getEnvValue } from "@/lib/config-bridge";
import type { MaterialCard } from "@/lib/ai/skills/enhance";

export type SearchMaterialInput = {
  query: string;
  maxResults?: number;
};

/** 是否启用内容外搜：有 Key 且开关未显式关闭 */
export function isContentWebSearchEnabled(): boolean {
  const key = (getEnvValue("TAVILY_API_KEY") ?? process.env.TAVILY_API_KEY ?? "").trim();
  if (!key) return false;
  const flag = (
    getEnvValue("CONTENT_WEB_SEARCH") ??
    process.env.CONTENT_WEB_SEARCH ??
    "on"
  )
    .trim()
    .toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off" && flag !== "no";
}

/**
 * Tavily 轻量检索。失败返回空数组（调用方降级本地加料）。
 */
export async function searchMaterialCards(
  input: SearchMaterialInput,
): Promise<MaterialCard[]> {
  const apiKey = (getEnvValue("TAVILY_API_KEY") ?? process.env.TAVILY_API_KEY ?? "").trim();
  if (!apiKey) return [];

  const maxResults = Math.min(5, Math.max(1, input.maxResults ?? 4));
  const query = input.query.trim().slice(0, 240);
  if (!query) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        max_results: maxResults,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[web-search] tavily HTTP ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const cards: MaterialCard[] = [];
    for (const item of data.results ?? []) {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const snippet = typeof item.content === "string" ? item.content.trim() : "";
      if (!snippet && !title) continue;
      cards.push({
        title: title || "未命名来源",
        url: typeof item.url === "string" ? item.url : undefined,
        snippet: snippet.slice(0, 280),
      });
      if (cards.length >= maxResults) break;
    }
    return cards;
  } catch (error) {
    console.warn(
      "[web-search] tavily failed:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/** 每篇 1–2 次查询，合并去重后取 Top N */
export async function gatherArticleMaterialCards(input: {
  topic: string;
  atomicInsight?: string | null;
  firstHeading?: string | null;
}): Promise<MaterialCard[]> {
  if (!isContentWebSearchEnabled()) return [];

  const topic = input.topic.trim();
  const insight = input.atomicInsight?.trim() ?? "";
  const heading = input.firstHeading?.trim() ?? "";

  const queries = [
    [topic, insight].filter(Boolean).join(" "),
    heading && heading !== topic ? `${topic} ${heading}` : "",
  ].filter((q) => q.length >= 4);

  const seen = new Set<string>();
  const merged: MaterialCard[] = [];

  for (const query of queries.slice(0, 2)) {
    const cards = await searchMaterialCards({ query, maxResults: 4 });
    for (const card of cards) {
      const key = (card.url || card.title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(card);
      if (merged.length >= 5) return merged;
    }
  }
  return merged;
}
