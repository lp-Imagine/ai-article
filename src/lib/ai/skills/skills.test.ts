import { describe, expect, it } from "vitest";
import type { OutlineOption } from "@/types/article";
import {
  enhanceModeFromFramework,
  fallbackBlueprint,
  normalizeBlueprint,
  sectionDirective,
} from "@/lib/ai/skills/content";
import {
  applyEnhanceBriefToBlueprint,
  insertEditAnchors,
  normalizeEnhanceBrief,
} from "@/lib/ai/skills/enhance";
import {
  assessOutlineDiversity,
  assessSingleOutlineQuality,
  normalizeOutlineConflict,
  outlineSkeletonSignature,
  pickOutlineSeedHints,
} from "@/lib/ai/skills/outline";
import { buildQualityRepairBrief } from "@/lib/ai/skills/refine";

const outline: OutlineOption = {
  index: 0,
  title: "Monorepo 选型不是工具投票",
  positioning: "用迁移成本和团队约束做选型",
  atomicInsight: "选型看迁移成本，不看工具人气",
  framework: "compare",
  readerTension: "团队在投 Nx 还是 Turborepo 时卡住",
  sections: [
    { heading: "先画清仓库边界", summary: "列出共享代码与独立发布单元" },
    { heading: "Turborepo 和 Nx 怎么取舍", summary: "用任务图和治理能力做对比" },
    { heading: "用一周试点验证", summary: "迁移检查表与退出条件写清楚" },
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
    expect(first.atomicInsight).toBe("选型看迁移成本，不看工具人气");
    expect(first.enhanceMode).toBe("voice");
    expect(first.readerTension).toContain("Nx");
  });

  it("maps outline framework to enhanceMode", () => {
    expect(enhanceModeFromFramework("hot-take")).toBe("angle");
    expect(enhanceModeFromFramework("list")).toBe("density");
    expect(enhanceModeFromFramework("pain")).toBe("density");
    expect(enhanceModeFromFramework("story")).toBe("detail");
    expect(enhanceModeFromFramework("compare")).toBe("voice");
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
    expect(directive).toMatch(/本章证据类型：/);
    expect(directive).toContain("本章禁止重复：先画清仓库边界");
    expect(directive).toContain("专栏笔记");
    expect(directive).toContain("Atomic Insight");
    expect(directive).toContain("选型看迁移成本");
    expect(blueprint.readerTension).toContain("Nx");
    expect(blueprint.bannedPatterns.some((p) => /翻车/.test(p))).toBe(true);
    expect(blueprint.sectionPlans.every((p) => !/^给出/.test(p.evidencePlan))).toBe(true);
  });

  it("keeps upstream insight when normalizing blueprint", () => {
    const fallback = fallbackBlueprint({ topic: "前端 monorepo 治理", outline, engineering: true });
    const normalized = normalizeBlueprint(
      { atomicInsight: "要坚持长期主义赋能", enhanceMode: "angle" },
      fallback,
    );
    expect(normalized.atomicInsight).toBe(fallback.atomicInsight);
    expect(normalized.enhanceMode).toBe("angle");
  });

  it("strips PRD voice when normalizing blueprint contributions", () => {
    const fallback = fallbackBlueprint({ topic: "前端 monorepo 治理", outline, engineering: true });
    const normalized = normalizeBlueprint(
      {
        sectionPlans: [
          {
            heading: "先画清仓库边界",
            uniqueContribution: "给出共享代码与独立发布单元清单",
            evidencePlan: "给出接口定义",
          },
        ],
      },
      fallback,
    );
    expect(normalized.sectionPlans[0].uniqueContribution).not.toMatch(/^给出/);
    expect(normalized.sectionPlans[0].evidencePlan).not.toMatch(/^给出/);
  });
});

describe("outline and refine skills", () => {
  it("detects near-identical outline variants", () => {
    const copy = { ...outline, index: 1, title: `${outline.title}怎么做` };
    const result = assessOutlineDiversity([outline, copy]);

    expect(result.score).toBeLessThan(70);
    expect(result.issues).toContain("多套大纲的标题与章节骨架过于相似");
  });

  it("flags shared 翻车→诱因→标准流水线 across schemes", () => {
    const a: OutlineOption = {
      index: 0,
      title: "跳槽前避开半年弯路",
      positioning: "用翻车场景做决策",
      sections: [
        { heading: "同事翻车现场", summary: "跳后半年就后悔" },
        { heading: "核心诱因是需求错配", summary: "不是薪资而是错配" },
        { heading: "跳槽判断标准", summary: "对照决策依据" },
      ],
    };
    const b: OutlineOption = {
      index: 1,
      title: "跳槽别再踩半年坑",
      positioning: "从踩坑现场写起",
      sections: [
        { heading: "真实翻车弯路", summary: "入职即后悔" },
        { heading: "诱因不是钱", summary: "隐形错配" },
        { heading: "行动清单", summary: "照做避坑指南" },
      ],
    };
    const result = assessOutlineDiversity([a, b]);
    expect(result.issues.some((i) => /翻车|修辞骨架/.test(i))).toBe(true);
    expect(outlineSkeletonSignature(a)).toContain("crash");
  });

  it("rejects PRD-voice summaries on a single outline", () => {
    const bad: OutlineOption = {
      index: 0,
      title: "某某主题",
      positioning: "测试",
      sections: [
        { heading: "第一章", summary: "给出可落地的决策依据" },
        { heading: "第二章", summary: "通过场景拆解输出标准" },
        { heading: "第三章", summary: "锚定主题痛点" },
      ],
    };
    expect(assessSingleOutlineQuality(bad).ok).toBe(false);
  });

  it("picks seed hints by topic instead of fixed index-0 crash angle", () => {
    const a = pickOutlineSeedHints(3, "跳槽避坑");
    const b = pickOutlineSeedHints(3, "前端 monorepo");
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a[0]).not.toEqual(b[0]);
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

  it("normalizes outline conflicts with insight/framework fallbacks", () => {
    const conflict = normalizeOutlineConflict({
      tension: "选型时只看人气会拖垮迁移",
      readerMoment: "投工具投票的会上",
      stake: "半年后拆仓成本翻倍",
      avoidSkeleton: "不走翻车→诱因→清单",
    });
    expect(conflict).not.toBeNull();
    expect(conflict!.atomicInsight.length).toBeGreaterThanOrEqual(8);
    expect(conflict!.frameworkHint).toBe("pain");
  });

  it("flags identical frameworks across schemes", () => {
    const a = { ...outline, index: 0, framework: "list" as const, title: "方案甲" };
    const b = {
      ...outline,
      index: 1,
      framework: "list" as const,
      title: "完全不同的标题乙",
      atomicInsight: "另一句完全不同的洞见内容",
      sections: [
        { heading: "完全不同章一", summary: "另一路径" },
        { heading: "完全不同章二", summary: "另一对比" },
        { heading: "完全不同章三", summary: "另一试点" },
      ],
    };
    const result = assessOutlineDiversity([a, b]);
    expect(result.issues).toContain("多套大纲写作框架完全相同");
  });
});

describe("enhance brief skill", () => {
  it("merges section evidence boosts into blueprint", () => {
    const blueprint = fallbackBlueprint({
      topic: "前端 monorepo 治理",
      outline,
      engineering: true,
    });
    const brief = normalizeEnhanceBrief(
      {
        angleSharpen: "先算迁移成本再谈工具",
        concreteAnchors: ["某中台团队拆仓当晚"],
        sectionHints: outline.sections.map((s) => ({
          heading: s.heading,
          evidenceBoost: `针对「${s.heading}」写清退出条件`,
        })),
      },
      outline,
    );
    expect(brief).not.toBeNull();
    const enhanced = applyEnhanceBriefToBlueprint(blueprint, brief!);
    expect(enhanced.sectionPlans[0].evidencePlan).toContain("退出条件");
    expect(enhanced.thesis).toContain("锐化");
  });

  it("inserts edit anchors between sections", () => {
    const html = insertEditAnchors(
      "<p>开篇</p>\n<hr />\n<h2>一</h2><p>内容</p>\n<hr />\n<h2>二</h2><p>更多</p>",
    );
    expect(html).toContain("<!-- edit-anchor:");
    expect((html.match(/<!-- edit-anchor:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
