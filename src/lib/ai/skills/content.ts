import type { OutlineOption, OutlineSection } from "@/types/article";
import type { SkillDefinition } from "@/lib/ai/skills/types";
import { CONTENT_PROMPT_VERSION } from "@/lib/ai/prompts/content";

export const CONTENT_SKILL: SkillDefinition = {
  name: "article-blueprint",
  version: CONTENT_PROMPT_VERSION,
  description: "先确定全文独特论点、切入角和逐章证据计划，再并行生成章节。",
};

export type EvidenceMode =
  | "code-or-interface"
  | "decision-comparison"
  | "failure-analysis"
  | "worked-example"
  | "checklist"
  | "boundary-case"
  | "observable-scene";

export type SectionPlan = {
  heading: string;
  uniqueContribution: string;
  evidenceMode: EvidenceMode;
  evidencePlan: string;
  doNotRepeat: string[];
};

export type ArticleBlueprint = {
  angle: string;
  thesis: string;
  readerTension: string;
  openingMode: string;
  endingMode: string;
  bannedPatterns: string[];
  sectionPlans: SectionPlan[];
};

const GENERAL_EVIDENCE: EvidenceMode[] = [
  "observable-scene",
  "decision-comparison",
  "worked-example",
  "failure-analysis",
  "checklist",
  "boundary-case",
];

const ENGINEERING_EVIDENCE: EvidenceMode[] = [
  "code-or-interface",
  "failure-analysis",
  "decision-comparison",
  "worked-example",
  "boundary-case",
  "checklist",
];

const ANGLES = [
  "从一个具体决策的取舍切入",
  "从最容易失败的环节反推正确做法",
  "从最小可用实现逐步加复杂度",
  "从两种常见方案的代价对比切入",
  "从一个反直觉判断展开论证",
  "从发布前真正需要验证的结果倒推",
];

function stableIndex(text: string, size: number): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % size;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(asString).filter(Boolean).slice(0, 6)
    : [];
}

function evidenceMode(value: unknown, fallback: EvidenceMode): EvidenceMode {
  const allowed = new Set<EvidenceMode>([
    "code-or-interface",
    "decision-comparison",
    "failure-analysis",
    "worked-example",
    "checklist",
    "boundary-case",
    "observable-scene",
  ]);
  return typeof value === "string" && allowed.has(value as EvidenceMode)
    ? (value as EvidenceMode)
    : fallback;
}

function fallbackSectionPlan(
  section: OutlineSection,
  index: number,
  engineering: boolean,
  previous: OutlineSection[],
): SectionPlan {
  const modes = engineering ? ENGINEERING_EVIDENCE : GENERAL_EVIDENCE;
  return {
    heading: section.heading,
    uniqueContribution:
      section.summary || `只回答「${section.heading}」对应的一个具体问题`,
    evidenceMode: modes[index % modes.length],
    evidencePlan: engineering
      ? "给出接口、代码、状态、命令或可验证边界中的至少一种"
      : "给出具体场景、前后对比、步骤、反例或判断标准中的至少一种",
    doNotRepeat: previous.map((item) => item.heading).slice(-2),
  };
}

export function fallbackBlueprint(input: {
  topic: string;
  outline: OutlineOption;
  engineering: boolean;
}): ArticleBlueprint {
  const angle = ANGLES[stableIndex(`${input.topic}:${input.outline.title}`, ANGLES.length)];
  return {
    angle,
    thesis: `${input.outline.positioning || input.outline.title}；全文用可验证信息回答主题，而不是解释概念。`,
    readerTension: `读者知道「${input.topic}」是什么，但缺少做决策或真正落地的判断依据。`,
    openingMode: "先给结论或决策冲突，再说明本文会解决的具体问题",
    endingMode: "收束为判断标准、检查清单或下一步动作，不做价值升华",
    bannedPatterns: [
      "定义→重要性→方法论→注意事项→总结",
      "虚构朋友或同事对话开篇",
      "每章重复解释主题背景",
      "首先/其次/最后机械排比",
    ],
    sectionPlans: input.outline.sections.map((section, index, all) =>
      fallbackSectionPlan(section, index, input.engineering, all.slice(0, index)),
    ),
  };
}

export function normalizeBlueprint(
  value: unknown,
  fallback: ArticleBlueprint,
): ArticleBlueprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const rawPlans = Array.isArray(record.sectionPlans) ? record.sectionPlans : [];
  const plans = fallback.sectionPlans.map((base, index) => {
    const raw = rawPlans[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
    const item = raw as Record<string, unknown>;
    return {
      heading: base.heading,
      uniqueContribution: asString(item.uniqueContribution) || base.uniqueContribution,
      evidenceMode: evidenceMode(item.evidenceMode, base.evidenceMode),
      evidencePlan: asString(item.evidencePlan) || base.evidencePlan,
      doNotRepeat: asStringArray(item.doNotRepeat).length
        ? asStringArray(item.doNotRepeat)
        : base.doNotRepeat,
    };
  });

  return {
    angle: asString(record.angle) || fallback.angle,
    thesis: asString(record.thesis) || fallback.thesis,
    readerTension: asString(record.readerTension) || fallback.readerTension,
    openingMode: asString(record.openingMode) || fallback.openingMode,
    endingMode: asString(record.endingMode) || fallback.endingMode,
    bannedPatterns: asStringArray(record.bannedPatterns).length
      ? asStringArray(record.bannedPatterns)
      : fallback.bannedPatterns,
    sectionPlans: plans,
  };
}

export function sectionDirective(
  blueprint: ArticleBlueprint,
  index: number,
): string {
  const plan = blueprint.sectionPlans[index];
  if (!plan) return "";
  const positionRule =
    index === 0
      ? `- 开篇衔接方式：${blueprint.openingMode}`
      : index === blueprint.sectionPlans.length - 1
        ? `- 结尾交付方式：${blueprint.endingMode}`
        : "";
  return `【全篇蓝图（本章必须服从）】
- 全文切入角：${blueprint.angle}
- 全文核心判断：${blueprint.thesis}
- 本章唯一贡献：${plan.uniqueContribution}
- 本章证据类型：${plan.evidenceMode}
- 本章证据计划：${plan.evidencePlan}
- 本章禁止重复：${plan.doNotRepeat.length ? plan.doNotRepeat.join("；") : "其他章节已解释的背景"}
- 读者当前冲突：${blueprint.readerTension}
${positionRule}
- 禁止套用的骨架：${blueprint.bannedPatterns.join("；")}`;
}

export const BLUEPRINT_JSON_INSTRUCTION = `
除 title / summary / openingHtml 外，必须返回 blueprint：
{
  "angle": "全文唯一切入角",
  "thesis": "全文只证明的核心判断",
  "readerTension": "读者真正卡住的冲突",
  "openingMode": "开篇方式",
  "endingMode": "结尾交付物",
  "bannedPatterns": ["本篇禁止使用的模板骨架"],
  "sectionPlans": [
    {
      "heading": "与大纲标题一致",
      "uniqueContribution": "本章新增且其他章不再重复的信息",
      "evidenceMode": "code-or-interface | decision-comparison | failure-analysis | worked-example | checklist | boundary-case | observable-scene",
      "evidencePlan": "本章具体用什么支撑观点",
      "doNotRepeat": ["已由其他章负责的内容"]
    }
  ]
}
sectionPlans 数量和顺序必须与大纲章节完全一致；各章 uniqueContribution / evidenceMode 不得雷同。`;
