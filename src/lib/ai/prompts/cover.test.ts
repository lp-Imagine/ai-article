import { describe, expect, it } from "vitest";
import { buildInfographicPrompt, softClipLabel } from "./cover";

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

describe("buildInfographicPrompt", () => {
  it("uses soft clay style, three cards, and forbids title plaques", () => {
    const prompt = buildInfographicPrompt(
      {
        title: "RAG私有检索故障",
        panels: [
          { role: "cause", label: "缺标量索引", caption: "过滤失效", visual: "filter icon" },
          { role: "step", label: "RAG检索", caption: "过滤失败", visual: "nodes" },
          { role: "result", label: "错误结果", caption: "只回公开模板", visual: "document" },
          { role: "step", label: "多余第四格", caption: "应被丢掉", visual: "x" },
        ],
        summary: "缺索引→漏检索",
      },
      "three equal cards",
      0,
      3,
    );

    expect(prompt).toContain("soft claymorphism");
    expect(prompt).toContain("warm cream");
    expect(prompt).not.toContain("RAG私有检索故障");
    expect(prompt).not.toMatch(/Top-left Chinese title/);
    expect(prompt).toContain("标题设计");
    expect(prompt).toContain("Clay card 3:");
    expect(prompt).not.toContain("多余第四格");
    expect(prompt).toContain("Never crop");
    expect(prompt).toContain("no ghosted layers");
  });
});
