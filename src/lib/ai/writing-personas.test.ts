import { afterEach, describe, expect, it } from "vitest";
import {
  buildWritingPersonaBlock,
  getWritingPersonaId,
  isWritingPersonaId,
  mergeWritingPreferences,
  parseWritingPreferences,
} from "@/lib/ai/writing-personas";
import {
  extractPreferenceRulesFromDiff,
  extractStyleExcerpts,
} from "@/lib/ai/style-salt";

describe("writing personas", () => {
  afterEach(() => {
    delete process.env.WRITING_PERSONA;
  });

  it("defaults to notes when unset", () => {
    expect(getWritingPersonaId()).toBe("notes");
    expect(buildWritingPersonaBlock()).toContain("干货笔记");
  });

  it("respects WRITING_PERSONA env", () => {
    process.env.WRITING_PERSONA = "sharp";
    expect(getWritingPersonaId()).toBe("sharp");
    expect(buildWritingPersonaBlock()).toContain("锐评观察");
  });

  it("validates persona ids", () => {
    expect(isWritingPersonaId("warm")).toBe(true);
    expect(isWritingPersonaId("midnight")).toBe(false);
  });

  it("parses and merges preference rules", () => {
    expect(parseWritingPreferences(JSON.stringify(["避免赋能", "偏好短收束"]))).toEqual([
      "避免赋能",
      "偏好短收束",
    ]);
    const merged = mergeWritingPreferences(
      ["旧规则甲"],
      ["避免使用「赋能」这类套话", "旧规则甲"],
    );
    expect(merged[0]).toContain("赋能");
    expect(merged.filter((r) => r === "旧规则甲")).toHaveLength(1);
  });
});

describe("style salt excerpts", () => {
  it("extracts opening / turn / ending from html", () => {
    const html = `
      <p>开篇先抛冲突：联调超时没人认。</p>
      <p>中间补一句边界：权限和超时策略要写进合同。</p>
      <p>收束：先定责任，再谈重试。</p>
    `;
    const excerpts = extractStyleExcerpts(html);
    expect(excerpts?.opening).toContain("联调超时");
    expect(excerpts?.ending).toContain("先定责任");
    expect(excerpts?.turn.length).toBeGreaterThan(8);
  });
});

describe("polish diff learning", () => {
  it("learns removed cliches and shorter pace", () => {
    const before = `<p>${"首先这是赋能与底层逻辑的长句，值得注意的是还要闭环。".repeat(4)}</p><p>其次我们继续正确废话凑字。</p>`;
    const after = `<p>超时责任不清就会互相甩锅，联调当晚没人认账。</p><p>先写清兜底策略，再谈重试次数与告警。</p><p>别再用套话填版面。</p>`;
    const rules = extractPreferenceRulesFromDiff(before, after);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => /赋能|底层逻辑|套话/.test(r))).toBe(true);
  });
});
