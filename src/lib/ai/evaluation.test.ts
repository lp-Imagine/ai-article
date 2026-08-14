import { describe, expect, it } from "vitest";
import { evaluateArticle } from "@/lib/ai/evaluation";

describe("evaluateArticle", () => {
  it("penalizes template openings, generic headings, repetition and vague paragraphs", () => {
    const result = evaluateArticle({
      title: "长期学习系统",
      content: `
        <p>在当今时代，随着社会发展，学习的重要性不言而喻。</p>
        <h2>什么是长期学习</h2>
        <p>关键在于持续努力，实现认知升级和自我赋能。</p>
        <h2>总结与展望</h2>
        <p>关键在于持续努力，实现认知升级和自我赋能。</p>
      `,
    });

    expect(result.clicheHits).toBeGreaterThanOrEqual(4);
    expect(result.genericHeadingCount).toBe(2);
    expect(result.repeatedParagraphRate).toBeGreaterThan(0);
    expect(result.openingTemplateMatches).toBeGreaterThan(0);
    expect(result.lowDensityParagraphRate).toBe(1);
  });

  it("recognizes concrete, non-repeating paragraphs", () => {
    const result = evaluateArticle({
      title: "租房合同先查这三处",
      content: `
        <p>签字前先核对出租人姓名和房产证；不是本人时，要求查看授权委托书。</p>
        <h2>把提前解约写成金额</h2>
        <p>例如合同写“协商解决”时，改成提前 30 天通知并支付 1 个月租金。</p>
        <h2>交房当天留下证据</h2>
        <p>按房间拍摄水表、电表和墙面，再把文件名写成日期加房间位置。</p>
      `,
    });

    expect(result.clicheHits).toBe(0);
    expect(result.genericHeadingCount).toBe(0);
    expect(result.repeatedParagraphRate).toBe(0);
    expect(result.openingTemplateMatches).toBe(0);
    expect(result.lowDensityParagraphRate).toBe(0);
  });
});
