import { describe, expect, it } from "vitest";
import {
  IDEA_CATEGORY_LABELS,
  assessTopicIdeaQuality,
  inferPersonaBias,
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
  });

  it("accepts sharp insight with concrete topic", () => {
    expect(
      assessTopicIdeaQuality(
        "MCP 工具接进后台后，超时该谁兜",
        "权限边界不清会拖垮联调",
        "超时责任不清时，联调会变成互相甩锅",
      ).ok,
    ).toBe(true);
  });

  it("rejects formulaic history suffixes", () => {
    expect(assessTopicIdeaQuality("前端缓存：我会先做的 3 个关键动作").ok).toBe(false);
  });
});

describe("IDEA_CATEGORY_LABELS", () => {
  it("covers expected categories", () => {
    expect(IDEA_CATEGORY_LABELS.career).toContain("职场");
    expect(IDEA_CATEGORY_LABELS.ai).toContain("AI");
  });
});
