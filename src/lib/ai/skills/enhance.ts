import type { OutlineOption } from "@/types/article";
import type { ArticleBlueprint, EvidenceMode, EnhanceMode } from "@/lib/ai/skills/content";
import type { ChatMessage } from "@/lib/ai/types";
import type { SkillDefinition } from "@/lib/ai/skills/types";

export const ENHANCE_SKILL: SkillDefinition = {
  name: "content-enhance-brief",
  version: "1.1.0",
  description: "写前增强简报：为各章注入可核对证据与动手点；可选用外搜素材卡。",
};

export type EnhanceBrief = {
  /** 反直觉或更锐的论点补充（观点向） */
  angleSharpen: string;
  /** 可核对的匿名场景 / 数字口径（禁止编造姓名） */
  concreteAnchors: string[];
  /** 与大纲章节一一对应的证据加料 */
  sectionHints: Array<{
    heading: string;
    evidenceBoost: string;
  }>;
};

export type MaterialCard = {
  title: string;
  url?: string;
  snippet: string;
};

const ENHANCE_MODE_HINT: Record<EnhanceMode, string> = {
  angle: "优先锐化反直觉判断与代价，少堆步骤清单",
  density: "每章至少 1 个可动手点/检查项/边界条件",
  detail: "用匿名可核对场景推动洞见，禁止空喊复盘",
  voice: "写清取舍边界与适用条件，语气可带态度但不空喊",
};

const LOCAL_BOOST: Record<EvidenceMode, { eng: string; gen: string }> = {
  "code-or-interface": {
    eng: "放一段可粘贴的接口/类型或关键调用，点出边界条件",
    gen: "写清可核对的操作步骤或字段，禁止只喊原则",
  },
  "decision-comparison": {
    eng: "对比两种实现的代价与适用边界，写你会选哪边",
    gen: "把两个选项并排放，写清什么情况下选谁",
  },
  "failure-analysis": {
    eng: "还原一次误用/故障路径，落到根因与修复点",
    gen: "讲清一种做错法如何恶化，以及怎么提前识别",
  },
  "worked-example": {
    eng: "跟一条最小可跑路径，从输入写到可观察结果",
    gen: "用一个完整小例子走完决策，不要只列抽象原则",
  },
  checklist: {
    eng: "列发布前/合并前真要勾的几项，每项可验证",
    gen: "列读者立刻能自检的几条，避免空泛注意事项",
  },
  "boundary-case": {
    eng: "写清并发、空值、重试或取消等边界会怎样崩",
    gen: "写清例外情况与不适用人群，避免假万能建议",
  },
  "observable-scene": {
    eng: "用一次可观察的运行现象（日志/状态/耗时）开场",
    gen: "用一个读者认得的具体场面开场，再落到判断",
  },
};

function formatMaterialCards(cards: MaterialCard[] | undefined): string {
  if (!cards?.length) return "（无外搜素材，请用匿名可核对场景与量级口径）";
  return cards
    .slice(0, 5)
    .map((c, i) => {
      const src = c.url ? ` | ${c.url}` : "";
      return `${i + 1}. ${c.title}${src}\n   ${c.snippet.slice(0, 180)}`;
    })
    .join("\n");
}

export function buildEnhanceBriefPrompt(input: {
  topic: string;
  outline: OutlineOption;
  blueprint: ArticleBlueprint;
  engineering: boolean;
  materialCards?: MaterialCard[];
}): ChatMessage[] {
  const headings = input.outline.sections.map((s) => s.heading);
  return [
    {
      role: "system",
      content: `你是专栏写前策划。只输出一份「内容增强简报」，不写正文。

【目标】
- 钉住洞见：${input.blueprint.atomicInsight}
- 增强模式：${input.blueprint.enhanceMode}（${ENHANCE_MODE_HINT[input.blueprint.enhanceMode]}）
- 读者冲突：${input.blueprint.readerTension}
- ${input.engineering ? "工程向：证据加料偏向接口/命令/状态/测试边界，不要文学化" : "非工程：证据加料偏向场景/对比/反例/可执行判断"}

【外搜素材卡（只作锚点/口径，禁止整段抄进正文）】
${formatMaterialCards(input.materialCards)}
- 禁止编造精确百分比/姓名/公司；无出处则写「量级/匿名场景」
- 素材卡仅供启发场景与边界，不得逐句复述

【规则】
- 禁止编造姓名、公司、精确百分比；可用「某中台团队」「联调当晚」等匿名口径
- sectionHints 数量与顺序必须与章节标题完全一致
- evidenceBoost 一句话，直接可写进该章，禁止「给出/通过/拆解」起句
- angleSharpen ≤ 40 字，只锐化不换题
- concreteAnchors 2-4 条

【输出 JSON】
{ "angleSharpen": string, "concreteAnchors": string[], "sectionHints": [ { "heading": string, "evidenceBoost": string } ] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        topic: input.topic,
        atomicInsight: input.blueprint.atomicInsight,
        enhanceMode: input.blueprint.enhanceMode,
        sectionHeadings: headings,
        sectionSummaries: input.outline.sections.map((s) => ({
          heading: s.heading,
          summary: s.summary,
        })),
        sectionEvidenceModes: input.blueprint.sectionPlans.map((p) => p.evidenceMode),
      }),
    },
  ];
}

/** 本地确定性加料：LLM 失败或空简报时强制使用，禁止静默空加料 */
export function buildLocalEnhanceBrief(
  blueprint: ArticleBlueprint,
  outline: OutlineOption,
  opts?: { engineering?: boolean; materialCards?: MaterialCard[] },
): EnhanceBrief {
  const engineering = opts?.engineering ?? false;
  const insight =
    blueprint.atomicInsight.trim().slice(0, 40) ||
    outline.atomicInsight?.trim().slice(0, 40) ||
    outline.title.slice(0, 40);
  const anchors: string[] = [];
  if (opts?.materialCards?.length) {
    for (const card of opts.materialCards.slice(0, 2)) {
      const snip = card.snippet.replace(/\s+/g, " ").trim().slice(0, 60);
      if (snip) anchors.push(`素材启发：${snip}`);
    }
  }
  if (anchors.length < 2) {
    anchors.push(
      engineering
        ? `联调/发布当晚围绕「${outline.sections[0]?.heading ?? insight}」的可观察现象`
        : `读者卡住「${blueprint.readerTension.slice(0, 24) || insight}」的具体场面`,
    );
    anchors.push(
      engineering
        ? "匿名团队：某中台/业务线一次真实踩坑与修复点"
        : "匿名场景：某次选择做错后两周内的代价",
    );
  }

  return {
    angleSharpen: insight,
    concreteAnchors: anchors.slice(0, 4),
    sectionHints: blueprint.sectionPlans.map((plan, index) => {
      const section = outline.sections[index];
      const noun = (section?.heading ?? plan.heading).replace(/[：:].*$/, "").slice(0, 12);
      const hint = LOCAL_BOOST[plan.evidenceMode];
      const boost = engineering ? hint.eng : hint.gen;
      return {
        heading: plan.heading,
        evidenceBoost: `针对「${noun}」：${boost}`.slice(0, 120),
      };
    }),
  };
}

export function normalizeEnhanceBrief(
  value: unknown,
  outline: OutlineOption,
): EnhanceBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const angleSharpen =
    typeof record.angleSharpen === "string" ? record.angleSharpen.trim().slice(0, 48) : "";
  const concreteAnchors = Array.isArray(record.concreteAnchors)
    ? record.concreteAnchors
        .filter((x): x is string => typeof x === "string" && x.trim().length >= 4)
        .map((x) => x.trim().slice(0, 80))
        .slice(0, 4)
    : [];
  const rawHints = Array.isArray(record.sectionHints) ? record.sectionHints : [];
  const sectionHints = outline.sections.map((section, index) => {
    const raw = rawHints[index];
    const item =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    const boost =
      item && typeof item.evidenceBoost === "string"
        ? item.evidenceBoost.trim().replace(/^(给出|通过|拆解|输出|锚定)/u, "").trim()
        : "";
    return {
      heading: section.heading,
      evidenceBoost: boost.slice(0, 120),
    };
  });

  const filledHints = sectionHints.filter((h) => h.evidenceBoost.length >= 6).length;
  if (!angleSharpen && concreteAnchors.length === 0 && filledHints === 0) return null;

  return {
    angleSharpen: angleSharpen || outline.atomicInsight?.trim().slice(0, 48) || "",
    concreteAnchors,
    sectionHints: sectionHints.map((h, i) => ({
      ...h,
      evidenceBoost:
        h.evidenceBoost ||
        `写清「${outline.sections[i]?.heading ?? "本章"}」里读者能带走的一个具体判断`,
    })),
  };
}

/** 把增强简报并入蓝图各章 evidencePlan（不改 heading） */
export function applyEnhanceBriefToBlueprint(
  blueprint: ArticleBlueprint,
  brief: EnhanceBrief,
): ArticleBlueprint {
  const anchors =
    brief.concreteAnchors.length > 0
      ? `可核对锚点：${brief.concreteAnchors.slice(0, 2).join("；")}`
      : "";
  return {
    ...blueprint,
    thesis: brief.angleSharpen
      ? `${blueprint.thesis}（锐化：${brief.angleSharpen}）`
      : blueprint.thesis,
    sectionPlans: blueprint.sectionPlans.map((plan, index) => {
      const hint = brief.sectionHints[index];
      if (!hint?.evidenceBoost) return plan;
      const boost = hint.evidenceBoost;
      const merged = plan.evidencePlan.includes(boost)
        ? plan.evidencePlan
        : `${plan.evidencePlan}；加料：${boost}${anchors && index === 0 ? `；${anchors}` : ""}`;
      return { ...plan, evidencePlan: merged.slice(0, 220) };
    }),
  };
}

/** 在开篇后、中段、结尾前插入编辑锚点注释 */
export function insertEditAnchors(html: string): string {
  if (!html.trim() || html.includes("<!-- edit-anchor:")) return html;

  const parts = html.split(/\n?<hr\s*\/?>\n?/i);
  if (parts.length < 2) {
    const paras = html.split(/(?<=<\/p>)/i);
    if (paras.length < 3) return html;
    const mid = Math.floor(paras.length / 2);
    paras.splice(
      Math.min(2, paras.length - 1),
      0,
      `\n<!-- edit-anchor: 在此补一句你自己的判断或踩坑 -->\n`,
    );
    paras.splice(
      Math.min(mid + 1, paras.length - 1),
      0,
      `\n<!-- edit-anchor: 这里可换成你亲历过的具体例子 -->\n`,
    );
    return paras.join("");
  }

  const anchored = [...parts];
  anchored[0] = `${anchored[0]}\n<!-- edit-anchor: 在此补一句你自己的判断或踩坑 -->`;
  if (anchored.length >= 3) {
    const mid = Math.floor(anchored.length / 2);
    anchored[mid] = `<!-- edit-anchor: 这里可换成你亲历过的具体例子 -->\n${anchored[mid]}`;
  }
  const last = anchored.length - 1;
  anchored[last] = `<!-- edit-anchor: 结尾前可写「这篇故意没覆盖什么」 -->\n${anchored[last]}`;
  return anchored.join("\n<hr />\n");
}
