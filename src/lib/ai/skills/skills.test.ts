import { describe, expect, it } from "vitest";
import type { OutlineOption } from "@/types/article";
import {
  fallbackBlueprint,
  normalizeBlueprint,
  sectionDirective,
} from "@/lib/ai/skills/content";
import { assessOutlineDiversity } from "@/lib/ai/skills/outline";
import { buildQualityRepairBrief } from "@/lib/ai/skills/refine";

const outline: OutlineOption = {
  index: 0,
  title: "Monorepo 选型不是工具投票",
  positioning: "用迁移成本和团队约束做选型",
  sections: [
    { heading: "先画清仓库边界", summary: "列出共享代码与独立发布单元" },
    { heading: "Turborepo 和 Nx 怎么取舍", summary: "用任务图和治理能力做对比" },
    { heading: "用一周试点验证", summary: "给出迁移检查表与退出条件" },
  ],
};

describe("article blueprint skill", () => {
  it("builds deterministic, section-specific fallback plans", () => {
    const first = fallbackBlueprint({ topic: "前端 monorepo 治理", outline, engineering: true });
    const second = fallbackBlueprint({ topic: "前端 monorepo 治理", outline, engineering: true });

    expect(first).toEqual(second);
    expect(first.sectionPlans).toHaveLength(3);
    expect(new Set(first.sectionPlans.map((plan) => plan.evidenceMode)).size).toBe(3);
    expect(first.sectionPlans[1].doNotRepeat).toContain("先画清仓库边界");
  });

  it("normalizes incomplete model blueprints without changing outline headings", () => {
    const fallback = fallbackBlueprint({ topic: "前端 monorepo 治理", outline, engineering: true });
    const normalized = normalizeBlueprint(
      {
        angle: "从迁移失败的代价切入",
        sectionPlans: [
          { heading: "模型擅自改名", uniqueContribution: "识别拆仓边界", evidenceMode: "invalid" },
        ],
      },
      fallback,
    );

    expect(normalized.angle).toBe("从迁移失败的代价切入");
    expect(normalized.sectionPlans).toHaveLength(3);
    expect(normalized.sectionPlans[0].heading).toBe("先画清仓库边界");
    expect(normalized.sectionPlans[0].evidenceMode).toBe(fallback.sectionPlans[0].evidenceMode);
    expect(normalized.sectionPlans[2]).toEqual(fallback.sectionPlans[2]);
  });

  it("gives each section an explicit evidence and no-repeat contract", () => {
    const blueprint = fallbackBlueprint({ topic: "前端 monorepo 治理", outline, engineering: true });
    const directive = sectionDirective(blueprint, 1);

    expect(directive).toContain("本章唯一贡献：用任务图和治理能力做对比");
    expect(directive).toContain("本章证据类型：failure-analysis");
    expect(directive).toContain("本章禁止重复：先画清仓库边界");
  });
});

describe("outline and refine skills", () => {
  it("detects near-identical outline variants", () => {
    const copy = { ...outline, index: 1, title: `${outline.title}怎么做` };
    const result = assessOutlineDiversity([outline, copy]);

    expect(result.score).toBeLessThan(70);
    expect(result.issues).toContain("多套大纲的标题与章节骨架过于相似");
  });

  it("turns detected quality issues into a targeted repair brief", () => {
    const brief = buildQualityRepairBrief({
      issues: [{ code: "low_density", message: "内容缺少具体细节", severity: "high" }],
      suggestions: ["补充步骤或判断标准"],
    });

    expect(brief).toContain("[high] low_density: 内容缺少具体细节");
    expect(brief).toContain("补充步骤或判断标准");
    expect(brief).toContain("只修复清单命中的问题");
  });
});
