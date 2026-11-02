import { describe, expect, it } from "vitest";
import {
  IDEA_CATEGORY_LABELS,
  assessTopicIdeaQuality,
  inferPersonaBias,
  isUsableTopicInsight,
  isUsableTopicTension,
  synthesizeTopicInsight,
} from "@/lib/topic-ideas";

describe("inferPersonaBias", () => {
  it("defaults to tech when persona empty", () => {
    expect(inferPersonaBias("")).toBe("tech");
    expect(inferPersonaBias(null)).toBe("tech");
  });

  it("detects general-only persona", () => {
    expect(inferPersonaBias("专注职场成长与写作的公众号")).toBe("general");
  });

  it("detects tech-only persona", () => {
    expect(inferPersonaBias("前端工程师，写 React / AI 工程实践")).toBe("tech");
  });

  it("detects mixed persona", () => {
    expect(inferPersonaBias("程序员聊职场与前端工程")).toBe("mixed");
  });
});

describe("assessTopicIdeaQuality", () => {
  it("rejects vague chicken-soup topics", () => {
    expect(assessTopicIdeaQuality("AI 时代如何提升效率").ok).toBe(false);
    expect(assessTopicIdeaQuality("你必须知道的职场真相").ok).toBe(false);
  });

  it("accepts concrete conflict topics", () => {
    expect(
      assessTopicIdeaQuality("MCP 工具接进后台后，超时该谁兜", "权限边界不清会拖垮联调").ok,
    ).toBe(true);
  });

  it("rejects hollow insight even when topic is concrete", () => {
    expect(
      assessTopicIdeaQuality(
        "MCP 工具接进后台后，超时该谁兜",
        "权限边界不清会拖垮联调",
        "要坚持长期主义",
      ).ok,
    ).toBe(false);
    expect(
      assessTopicIdeaQuality(
        "MCP 工具接进后台后，超时该谁兜",
        "权限边界不清会拖垮联调",
        "关键在于体系化方法论",
      ).ok,
    ).toBe(false);
  });

  it("rejects meta synthetic insights", () => {
    expect(
      assessTopicIdeaQuality(
        "MCP 工具接进后台后，超时该谁兜",
        "权限边界不清会拖垮联调",
        "写清「超时」里那个可验证的取舍，别再堆正确废话",
      ).ok,
    ).toBe(false);
  });

  it("requires insight for LLM-style candidates", () => {
    expect(
      assessTopicIdeaQuality("MCP 工具接进后台后，超时该谁兜", "权限边界不清会拖垮联调", undefined, {
        requireInsight: true,
      }).ok,
    ).toBe(false);
  });

  it("accepts sharp insight with concrete topic", () => {
    expect(
      assessTopicIdeaQuality(
        "MCP 工具接进后台后，超时该谁兜",
        "权限边界不清会拖垮联调",
        "超时责任不清时，联调会变成互相甩锅",
        { tension: "联调当晚互相甩锅" },
      ).ok,
    ).toBe(true);
  });

  it("rejects formulaic history suffixes", () => {
    expect(assessTopicIdeaQuality("前端缓存：我会先做的 3 个关键动作").ok).toBe(false);
  });
});

describe("synthesizeTopicInsight", () => {
  it("does not promote meta reasons into insight", () => {
    const insight = synthesizeTopicInsight(
      "一次真实故障复盘：从报错到根因定位",
      "偏向前端 / AI / 工程向，适合快速开写。",
    );
    expect(insight).not.toMatch(/适合快速开写/);
    expect(isUsableTopicInsight(insight) || insight === "").toBe(true);
  });

  it("keeps conflict-bearing titles as insight drafts", () => {
    const insight = synthesizeTopicInsight("MCP 接后台后超时该谁兜：边界还是重试");
    expect(insight.length).toBeGreaterThanOrEqual(8);
    expect(isUsableTopicInsight(insight)).toBe(true);
  });
});

describe("isUsableTopicInsight / tension", () => {
  it("rejects hollow and meta insights", () => {
    expect(isUsableTopicInsight("要坚持长期主义")).toBe(false);
    expect(isUsableTopicInsight("写清「选题」里那个可验证的取舍")).toBe(false);
    expect(isUsableTopicInsight("超时责任不清时联调会甩锅")).toBe(true);
  });

  it("validates tension", () => {
    expect(isUsableTopicTension("很火")).toBe(false);
    expect(isUsableTopicTension("联调当晚互相甩锅")).toBe(true);
  });
});

describe("IDEA_CATEGORY_LABELS", () => {
  it("covers expected categories", () => {
    expect(IDEA_CATEGORY_LABELS.career).toContain("职场");
    expect(IDEA_CATEGORY_LABELS.ai).toContain("AI");
  });
});
