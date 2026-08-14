import { describe, expect, it } from "vitest";
import {
  extractSectionHtml,
  salvageTruncatedJsonHtml,
} from "@/lib/ai/extract-html";

describe("salvageTruncatedJsonHtml", () => {
  it("recovers HTML from JSON cut off mid-string", () => {
    const raw = `{"sectionHtml": "<h2>功能边界对比：过滤、SQL 与一致性</h2><p>过滤条件与混合查询是生产向量搜索的关键。</p><pre><code>SEL`;
    const html = salvageTruncatedJsonHtml(raw);
    expect(html.startsWith("<h2>功能边界对比")).toBe(true);
    expect(html).toContain("混合查询");
    expect(html.length).toBeGreaterThan(60);
  });

  it("unescapes JSON string fragments", () => {
    const raw = `{"sectionHtml": "<h2>标题</h2>\\n<p>第一段</p>\\n<pre><code>SELECT 1`;
    const html = salvageTruncatedJsonHtml(raw);
    expect(html).toContain("<h2>标题</h2>\n<p>第一段</p>");
  });
});

describe("extractSectionHtml", () => {
  it("uses complete JSON when parseable", () => {
    const html = extractSectionHtml(
      JSON.stringify({
        sectionHtml: "<h2>准备同一基准</h2><p>三库用同一份 100 万向量测试集。</p>",
      }),
      true,
    );
    expect(html).toContain("准备同一基准");
  });

  it("salvages truncated JSON instead of returning empty", () => {
    const raw = `{"sectionHtml": "<h2>核心性能实测：QPS、延迟与召回率</h2><p>同一台 8 核机器上跑 100 万 768 维向量。</p><p>Qdrant`;
    const html = extractSectionHtml(raw, true);
    expect(html.length).toBeGreaterThan(60);
    expect(html).toContain("核心性能实测");
  });

  it("falls back to raw HTML in plain mode", () => {
    const html = extractSectionHtml(
      "<h2>选型决策</h2><p>百万级以下优先 pgvector。</p>",
      false,
    );
    expect(html).toContain("选型决策");
  });
});
