import { describe, expect, it } from "vitest";
import { looksLikeModelReasoning, splitContentIntoRefineBlocks } from "./ai";

describe("looksLikeModelReasoning", () => {
  it("flags writing-planning text (reasoning leak)", () => {
    const leaked =
      "<p>开头，约600字去标签。不能重复前四章内容：自研摘要两种截断的覆盖对比；" +
      "需要整合但避免叙述实验细节。注意：HTML格式，mp-tip内仅单个ol。</p>";
    expect(looksLikeModelReasoning(leaked)).toBe(true);
  });

  it("does not flag normal article content", () => {
    const normal =
      '<h2>用一段长文本跑通两种压缩</h2><p>从电商售后工单系统导出一段脱敏对话，' +
      "共 2037 字，包含订单纠纷、退款诉求。分别调用 LLMLingua 默认参数和截断前 5 句的自研摘要，记录压缩后 token 数与耗时。</p>";
    expect(looksLikeModelReasoning(normal)).toBe(false);
  });

  it("requires at least two leak markers", () => {
    // 仅命中一个弱特征（正文偶尔会提"我们需要"）不算泄漏
    expect(looksLikeModelReasoning("<p>我们需要先理解预算约束，再决定压缩策略。</p>")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(looksLikeModelReasoning("")).toBe(false);
  });
});

describe("splitContentIntoRefineBlocks", () => {
  it("keeps the whole html as one block when there is no h2", () => {
    const html = "<p>开篇一段</p><p>第二段</p>";
    expect(splitContentIntoRefineBlocks(html)).toEqual([html]);
  });

  it("splits opening and each h2 section", () => {
    const html = [
      "<p>开篇</p>",
      "<hr />",
      "<h2>第一章</h2><p>正文一</p>",
      "<hr />",
      "<h2>第二章</h2><p>正文二</p>",
    ].join("\n");

    const blocks = splitContentIntoRefineBlocks(html);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("开篇");
    expect(blocks[1]).toMatch(/^<h2>第一章<\/h2>/);
    expect(blocks[2]).toMatch(/^<h2>第二章<\/h2>/);
  });

  it("drops no content when re-joined", () => {
    const html = '<p>开篇</p>\n<hr />\n<h2 class="x">一</h2><p>a</p>\n<hr />\n<h2>二</h2><p>b</p>';
    const joined = splitContentIntoRefineBlocks(html).join("\n");
    const strip = (s: string) => s.replace(/\s+/g, "");
    expect(strip(joined)).toBe(strip(html));
  });

  it("ignores a leading h2 without an opening block", () => {
    const html = "<h2>唯一章节</h2><p>内容</p>";
    expect(splitContentIntoRefineBlocks(html)).toEqual([html]);
  });
});
