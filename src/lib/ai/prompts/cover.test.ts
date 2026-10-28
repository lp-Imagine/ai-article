import { describe, expect, it } from "vitest";
import {
  buildInfographicPrompt,
  fitBeatLabel,
  fitSectionSummary,
  softClipLabel,
} from "./cover";

describe("softClipLabel", () => {
  it("keeps mixed Latin+Chinese titles intact within unit budget", () => {
    expect(softClipLabel("RAG私有检索故障", 8)).toBe("RAG私有检索故障");
    expect(softClipLabel("RAG私有检索故障", 10)).toBe("RAG私有检索故障");
  });

  it("does not chop a Latin acronym into letters", () => {
    expect(softClipLabel("Node.js超时定位", 6)).toBe("Node.js超时定位");
  });

  it("still truncates overly long Chinese by units", () => {
    expect(softClipLabel("这是一段特别长的中文标题需要截断", 6)).toBe("这是一段特别");
  });
});

describe("fitSectionSummary", () => {
  it("keeps short complete formulas", () => {
    expect(fitSectionSummary("40%→8%", 10)).toBe("40%→8%");
  });

  it("rejects stacked nonsense like 词词", () => {
    expect(fitSectionSummary("复杂词词词→无效", 10)).toBe("要点对照");
  });
});

describe("fitBeatLabel", () => {
  it("keeps short complete labels", () => {
    expect(fitBeatLabel("之前")).toBe("之前");
    expect(fitBeatLabel("误调用")).toBe("误调用");
  });

  it("drops bad or too-long labels", () => {
    expect(fitBeatLabel("测试案案")).toBeUndefined();
    expect(fitBeatLabel("这是一个很长的标签")).toBe("这是一个");
  });
});

describe("buildInfographicPrompt", () => {
  it("asks for a filled hero scene and forbids outer frame shadow", () => {
    const prompt = buildInfographicPrompt(
      {
        title: "RAG私有检索故障",
        mode: "hero",
        scene: "A soft clay funnel leaking private docs beside a locked vault",
        summary: "缺索引→漏检索",
        beats: [{ visual: "soft clay funnel" }, { visual: "soft clay vault" }],
      },
      "hero hint",
      0,
      3,
    );

    expect(prompt).not.toMatch(/\b16\s*:\s*9\b/);
    expect(prompt).toContain("Fill the middle of the frame");
    expect(prompt).toContain("「缺索引→漏检索」");
    expect(prompt).not.toContain("RAG私有检索故障");
    expect(prompt).toContain("aspect-ratio marks");
    expect(prompt).toContain("BLANK or show only abstract texture");
    expect(prompt).toContain("floating review/comment bubbles");
    expect(prompt).toContain("标题设计");
  });

  it("supports trio-short with short labels only", () => {
    const prompt = buildInfographicPrompt(
      {
        title: "流程",
        mode: "trio-short",
        scene: "three clay cards",
        summary: "三步收敛",
        beats: [
          { visual: "cause icon", label: "问题" },
          { visual: "method icon", label: "做法" },
          { visual: "result icon", label: "效果" },
        ],
      },
      "",
      1,
      2,
    );

    expect(prompt).toContain("THREE equal soft clay rounded cards");
    expect(prompt).toContain("「问题」");
    expect(prompt).toContain("「效果」");
    expect(prompt).toContain("「三步收敛」");
  });
});
