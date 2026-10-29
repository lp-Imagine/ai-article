import type { OutlineOption, OutlineSection } from "@/types/article";
import type { SkillDefinition } from "@/lib/ai/skills/types";
import { CONTENT_PROMPT_VERSION } from "@/lib/ai/prompts/content";

export const CONTENT_SKILL: SkillDefinition = {
  name: "article-blueprint",
  version: CONTENT_PROMPT_VERSION,
  description: "承接大纲冲突，定全文论点与逐章证据，再并行写章节。",
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

/** 仅作后备盐粒；优先用大纲 positioning */
const ANGLE_SALTS = [
  "从一个马上要做的具体决定写起",
  "从最容易做错的那一步反推",
  "只承诺一个最小可完成切片",
  "把两种做法放在同一张取舍桌上",
  "先钉住一个被当成常识的错法",
  "用「这篇故意不讲什么」收束边界",
];

const EVIDENCE_PLAN_HINT: Record<EvidenceMode, { engineering: string; general: string }> = {
  "code-or-interface": {
    engineering: "放一段可粘贴的接口/类型或关键调用，再用两句点出边界",
    general: "用可核对的操作步骤或字段说明支撑判断",
  },
  "decision-comparison": {
    engineering: "对比两种实现的代价与适用边界，写清你会选哪边",
    general: "把两个选项放在一起比代价，写清什么情况下选谁",
  },
  "failure-analysis": {
    engineering: "还原一次真实故障或误用路径，落到根因与修复点",
    general: "讲清一种常见做错法会怎样恶化，以及怎么提前识别",
  },
  "worked-example": {
    engineering: "跟一条最小可跑路径，从输入写到可观察结果",
    general: "用一个完整小例子走完决策，不要只列抽象原则",
  },
  checklist: {
    engineering: "列发布前/合并前真要勾的几项，每项可验证",
    general: "列读者立刻能自检的几条，避免空泛「注意事项」",
  },
  "boundary-case": {
    engineering: "写清并发、空值、重试或取消等边界会怎样崩",
    general: "写清例外情况与不适用人群，避免假万能建议",
  },
  "observable-scene": {
    engineering: "用一次可观察的运行现象（日志/状态/耗时）开场",
    general: "用一个读者认得的具体场面开场，再落到判断",
  },
};

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

function humanizeContribution(summary: string, heading: string): string {
  const cleaned = summary
    .trim()
    .replace(/^(给出|通过|拆解|输出|锚定|全面介绍|指出)/u, "")
    .trim();
  if (cleaned.length >= 6) return cleaned;
  return `只把「${heading}」说清楚，让读者多一个可带走的判断`;
}

function pickEvidenceMode(
  section: OutlineSection,
  index: number,
  engineering: boolean,
  used: Set<EvidenceMode>,
): EvidenceMode {
  const pool = engineering ? ENGINEERING_EVIDENCE : GENERAL_EVIDENCE;
  const preferred = pool[stableIndex(`${section.heading}:${index}`, pool.length)];
  if (!used.has(preferred)) return preferred;
  const next = pool.find((mode) => !used.has(mode));
  return next ?? preferred;
}

function evidencePlanFor(mode: EvidenceMode, engineering: boolean, section: OutlineSection): string {
  const hint = EVIDENCE_PLAN_HINT[mode];
  const base = engineering ? hint.engineering : hint.general;
  const noun = section.heading.replace(/[：:].*$/, "").slice(0, 12);
  return `${base}（贴着「${noun}」写，别写成万能模板）`;
}

function fallbackSectionPlan(
  section: OutlineSection,
  index: number,
  engineering: boolean,
  previous: OutlineSection[],
  usedModes: Set<EvidenceMode>,
): SectionPlan {
  const mode = pickEvidenceMode(section, index, engineering, usedModes);
  usedModes.add(mode);
  return {
    heading: section.heading,
    uniqueContribution: humanizeContribution(section.summary ?? "", section.heading),
    evidenceMode: mode,
    evidencePlan: evidencePlanFor(mode, engineering, section),
    doNotRepeat: previous.map((item) => item.heading).slice(-2),
  };
}

function deriveAngle(topic: string, outline: OutlineOption): string {
  const positioning = outline.positioning?.trim();
  if (positioning && positioning.length >= 8) {
    return `紧扣大纲定位「${positioning}」，不另起万能角`;
  }
  return ANGLE_SALTS[stableIndex(`${topic}:${outline.title}`, ANGLE_SALTS.length)];
}

function deriveTension(topic: string, outline: OutlineOption): string {
  const first = outline.sections[0];
  if (first?.summary?.trim()) {
    return `读者卡在「${first.heading}」：${humanizeContribution(first.summary, first.heading)}`;
  }
  if (outline.positioning?.trim()) {
    return `读者要的是：${outline.positioning.trim()}——不是又一篇「${topic}」概念介绍`;
  }
  return `读者面对「${topic}」时缺的是可执行判断，不是背景百科`;
}

export function fallbackBlueprint(input: {
  topic: string;
  outline: OutlineOption;
  engineering: boolean;
}): ArticleBlueprint {
  const usedModes = new Set<EvidenceMode>();
  return {
    angle: deriveAngle(input.topic, input.outline),
    thesis: `${input.outline.positioning || input.outline.title}；全文用可核对信息证明它，而不是解释名词。`,
    readerTension: deriveTension(input.topic, input.outline),
    openingMode: "前两段直接抛出读者冲突或核心判断，禁止闲聊代入与价值口号",
    endingMode: "收束为可带走的判断或下一步动作；允许写「这篇没覆盖什么」，不做升华鸡汤",
    bannedPatterns: [
      "定义→重要性→方法论→注意事项→总结",
      "翻车现场→核心诱因→判断标准→行动清单",
      "虚构朋友或同事对话开篇",
      "每章重复解释主题背景",
      "首先/其次/最后机械排比",
      "段首「给出/通过/拆解/输出/锚定」产品说明书腔",
    ],
    sectionPlans: input.outline.sections.map((section, index, all) =>
      fallbackSectionPlan(
        section,
        index,
        input.engineering,
        all.slice(0, index),
        usedModes,
      ),
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
    const evidencePlan = asString(item.evidencePlan) || base.evidencePlan;
    return {
      heading: base.heading,
      uniqueContribution:
        humanizeContribution(
          asString(item.uniqueContribution) || base.uniqueContribution,
          base.heading,
        ),
      evidenceMode: evidenceMode(item.evidenceMode, base.evidenceMode),
      evidencePlan: evidencePlan.replace(/^(给出|通过|拆解|输出|锚定)/u, "").trim() || base.evidencePlan,
      doNotRepeat: asStringArray(item.doNotRepeat).length
        ? asStringArray(item.doNotRepeat)
        : base.doNotRepeat,
    };
  });

  const mergedBanned = asStringArray(record.bannedPatterns);
  return {
    angle: asString(record.angle) || fallback.angle,
    thesis: asString(record.thesis) || fallback.thesis,
    readerTension: asString(record.readerTension) || fallback.readerTension,
    openingMode: asString(record.openingMode) || fallback.openingMode,
    endingMode: asString(record.endingMode) || fallback.endingMode,
    bannedPatterns: mergedBanned.length
      ? Array.from(new Set([...mergedBanned, ...fallback.bannedPatterns])).slice(0, 10)
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
        ? `- 结尾交付方式：${blueprint.endingMode}（指本章正文）；若追加总结卡片，必须是**整篇文章**的收束，非本章小结`
        : "";
  return `【全篇蓝图（本章必须服从）】
- 全文切入角：${blueprint.angle}
- 全文核心判断：${blueprint.thesis}
- 读者当前冲突：${blueprint.readerTension}
- 本章唯一贡献：${plan.uniqueContribution}
- 本章证据类型：${plan.evidenceMode}
- 本章怎么写：${plan.evidencePlan}
- 本章禁止重复：${plan.doNotRepeat.length ? plan.doNotRepeat.join("；") : "其他章节已解释的背景"}
${positionRule}
- 禁止套用的骨架：${blueprint.bannedPatterns.join("；")}
- 文风：像人写的专栏笔记，不要产品说明书；段首禁用「给出/通过/拆解/输出/锚定」
- 写完自检：读者是否多了一个可带走的具体判断（不是又听了一遍正确废话）`;
}

export const BLUEPRINT_JSON_INSTRUCTION = `
除 title / summary / openingHtml 外，必须返回 blueprint：
{
  "angle": "承接大纲定位的唯一切入，禁止换成万能角名",
  "thesis": "全文只证明的核心判断（人话）",
  "readerTension": "读者真正卡住的冲突，须含主题/大纲里的具体名词",
  "openingMode": "开篇方式（禁止闲聊代入）",
  "endingMode": "结尾收束方式（允许写未覆盖边界）",
  "bannedPatterns": ["本篇禁止的模板骨架，须包含对翻车流水线与 PRD 腔的禁令"],
  "sectionPlans": [
    {
      "heading": "与大纲标题一致",
      "uniqueContribution": "本章新增信息（禁止「给出/通过/拆解」起句）",
      "evidenceMode": "code-or-interface | decision-comparison | failure-analysis | worked-example | checklist | boundary-case | observable-scene",
      "evidencePlan": "本章具体怎么写证据（人话，贴章节标题）",
      "doNotRepeat": ["已由其他章负责的内容"]
    }
  ]
}
sectionPlans 数量和顺序必须与大纲章节完全一致；各章 uniqueContribution / evidenceMode 不得雷同；angle 与 readerTension 必须服务大纲 positioning，禁止整篇改写成「翻车→诱因→标准→清单」。`;
