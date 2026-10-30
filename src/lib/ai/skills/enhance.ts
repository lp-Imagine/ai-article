import type { OutlineOption } from "@/types/article";
import type { ArticleBlueprint, EnhanceMode } from "@/lib/ai/skills/content";
import type { ChatMessage } from "@/lib/ai/types";
import type { SkillDefinition } from "@/lib/ai/skills/types";

export const ENHANCE_SKILL: SkillDefinition = {
  name: "content-enhance-brief",
  version: "1.0.0",
  description: "写前增强简报：为各章注入可核对证据与动手点（无外搜）。",
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

const ENHANCE_MODE_HINT: Record<EnhanceMode, string> = {
  angle: "优先锐化反直觉判断与代价，少堆步骤清单",
  density: "每章至少 1 个可动手点/检查项/边界条件",
  detail: "用匿名可核对场景推动洞见，禁止空喊复盘",
  voice: "写清取舍边界与适用条件，语气可带态度但不空喊",
};

export function buildEnhanceBriefPrompt(input: {
  topic: string;
  outline: OutlineOption;
  blueprint: ArticleBlueprint;
  engineering: boolean;
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
      }),
    },
  ];
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
      evidenceBoost: boost.slice(0, 120) || `写清「${section.heading}」里读者能带走的一个具体判断`,
    };
  });

  if (!angleSharpen && concreteAnchors.length === 0) return null;
  return {
    angleSharpen: angleSharpen || outline.atomicInsight?.trim().slice(0, 48) || "",
    concreteAnchors,
    sectionHints,
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
