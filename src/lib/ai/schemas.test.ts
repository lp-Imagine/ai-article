import { describe, expect, it } from "vitest";
import {
  coverPromptLlmSchema,
  parseLlmJson,
  sectionStoryboardLlmSchema,
  summaryLlmSchema,
  titlesLlmSchema,
} from "./schemas";

describe("parseLlmJson + sectionStoryboardLlmSchema", () => {
  it("accepts a valid hero storyboard", () => {
    const raw = JSON.stringify({
      mode: "hero",
      title: "漏检",
      scene: "A soft clay funnel beside a vault",
      summary: "缺索引→漏检索",
      beats: [{ visual: "soft clay funnel" }],
    });
    const parsed = parseLlmJson(sectionStoryboardLlmSchema, raw);
    expect(parsed?.mode).toBe("hero");
    expect(parsed?.summary).toBe("缺索引→漏检索");
  });

  it("rejects noisy stacked summary", () => {
    const raw = JSON.stringify({
      mode: "duo",
      scene: "before after",
      summary: "复杂词词词→无效",
      beats: [{ visual: "a" }, { visual: "b" }],
    });
    expect(parseLlmJson(sectionStoryboardLlmSchema, raw)).toBeNull();
  });

  it("rejects empty scene without beats", () => {
    const raw = JSON.stringify({
      mode: "hero",
      summary: "本章要点",
      scene: "",
      beats: [],
    });
    expect(parseLlmJson(sectionStoryboardLlmSchema, raw)).toBeNull();
  });

  it("parses fenced JSON", () => {
    const raw = "```json\n{\"summary\":\"缺索引→漏检索\",\"scene\":\"clay vault\",\"beats\":[{\"visual\":\"vault\"}]}\n```";
    expect(parseLlmJson(sectionStoryboardLlmSchema, raw)?.scene).toBe("clay vault");
  });
});

describe("coverPromptLlmSchema", () => {
  it("accepts prompt + subtitle", () => {
    const parsed = parseLlmJson(
      coverPromptLlmSchema,
      JSON.stringify({
        prompt: "Soft clay robot on cream canvas",
        subtitle: "降误调用",
        keywords: ["Agent", "提示词"],
      }),
    );
    expect(parsed?.prompt).toContain("Soft clay");
    expect(parsed?.subtitle).toBe("降误调用");
  });

  it("rejects stacked subtitle", () => {
    expect(
      parseLlmJson(
        coverPromptLlmSchema,
        JSON.stringify({ prompt: "x", subtitle: "词词词指南" }),
      ),
    ).toBeNull();
  });
});

describe("titlesLlmSchema / summaryLlmSchema", () => {
  it("parses titles", () => {
    const parsed = parseLlmJson(
      titlesLlmSchema,
      JSON.stringify({ titles: [{ text: "标题A", style: "悬念" }] }),
    );
    expect(parsed?.titles[0]?.text).toBe("标题A");
  });

  it("parses summary", () => {
    const parsed = parseLlmJson(summaryLlmSchema, JSON.stringify({ summary: "这是一段足够长的摘要内容用于展示" }));
    expect(parsed?.summary.length).toBeGreaterThan(10);
  });
});
