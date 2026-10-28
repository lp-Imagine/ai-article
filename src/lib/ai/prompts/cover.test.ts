import { describe, expect, it } from "vitest";
import {
  buildInfographicPrompt,
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

describe("buildInfographicPrompt", () => {
  it("paints only one Chinese summary and uses hero scene, not labeled cards", () => {
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

    expect(prompt).toContain("soft claymorphism");
    expect(prompt).toContain("「缺索引→漏检索」");
    expect(prompt).toContain("ONE large central soft clay metaphor");
    expect(prompt).not.toContain("RAG私有检索故障");
    expect(prompt).not.toContain("Clay card");
    expect(prompt).toContain("标题设计");
    expect(prompt).toContain("graph-paper");
    expect(prompt).toContain("ONLY Chinese lettering");
  });

  it("supports duo mode without Chinese on objects", () => {
    const prompt = buildInfographicPrompt(
      {
        title: "对比",
        mode: "duo",
        scene: "before after clay props",
        summary: "40%→8%",
        beats: [
          { visual: "messy clay prompt blob" },
          { visual: "clean clay rule card" },
        ],
      },
      "",
      1,
      2,
    );

    expect(prompt).toContain("TWO soft clay objects");
    expect(prompt).toContain("no Chinese on the objects");
    expect(prompt).toContain("「40%→8%」");
  });
});
