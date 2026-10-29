import type { OutlineOption } from "@/types/article";
import { OUTLINE_SEED_HINTS } from "@/lib/ai/constants";
import { OUTLINE_PROMPT_VERSION } from "@/lib/ai/prompts/outline";
import type { OutlineConflict } from "@/lib/ai/prompts/outline";
import type { SkillDefinition } from "@/lib/ai/skills/types";

export const OUTLINE_SKILL: SkillDefinition = {
  name: "outline-strategy",
  version: OUTLINE_PROMPT_VERSION,
  description: "先挖主题专属冲突，再生成结构与落点不同的大纲。",
};

/** 主题哈希选盐，避免 index%N 导致第 1 套永远是「翻车角」 */
export function pickOutlineSeedHints(count: number, topic: string): string[] {
  const pool = [...OUTLINE_SEED_HINTS];
  const seed = [...topic].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  // 旋转起点 + 简单洗牌，使同主题多次生成也相对稳定、跨主题分布不同
  const rotated = [...pool.slice(seed % pool.length), ...pool.slice(0, seed % pool.length)];
  for (let i = rotated.length - 1; i > 0; i -= 1) {
    const j = (seed * 31 + i * 17) % (i + 1);
    [rotated[i], rotated[j]] = [rotated[j], rotated[i]];
  }
  const hints: string[] = [];
  for (let i = 0; i < count; i += 1) {
    hints.push(rotated[i % rotated.length]);
  }
  return hints;
}

/** @deprecated 使用 pickOutlineSeedHints；保留兼容 */
export function outlineAngleAt(index: number): string {
  return OUTLINE_SEED_HINTS[index % OUTLINE_SEED_HINTS.length];
}

const PRD_SUMMARY_START =
  /^(给出|通过|拆解|输出|锚定|全面介绍|指出|分别给出)/u;

const GENERIC_HEADING =
  /^(什么是|为什么重要|方法论|注意事项|总结与展望|写在最后|结语|收尾)/u;

/** 修辞骨架标签：用于抓「换词同构」 */
const SKELETON_TAGS: Array<{ id: string; re: RegExp }> = [
  { id: "crash", re: /翻车|后悔|踩坑|现场|弯路/u },
  { id: "cause", re: /诱因|根因|本质|不是.{0,8}是|错配/u },
  { id: "criteria", re: /判断标准|决策依据|核心判断|选型标准/u },
  { id: "playbook", re: /清单|照做|行动项|步骤清单|避坑指南/u },
  { id: "myth", re: /误解|以为|其实不然|认知纠偏/u },
  { id: "compare", re: /对比|选型|取舍|还是该/u },
  { id: "howto", re: /三步|方法论|闭环|体系化/u },
];

export function outlineSkeletonSignature(outline: OutlineOption): string {
  const text = `${outline.title}|${outline.sections
    .map((s) => `${s.heading}|${s.summary}`)
    .join("|")}`;
  return SKELETON_TAGS.filter((tag) => tag.re.test(text))
    .map((tag) => tag.id)
    .join(">");
}

function normalizedWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[\s，。！？：；、,.!?:;（）()【】\[\]《》]/g, "")
      .split("")
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export function assessOutlineDiversity(outlines: OutlineOption[]): {
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let worstSimilarity = 0;
  for (let i = 0; i < outlines.length; i += 1) {
    const left = normalizedWords(
      `${outlines[i].title}${outlines[i].sections.map((section) => section.heading).join("")}`,
    );
    for (let j = i + 1; j < outlines.length; j += 1) {
      const right = normalizedWords(
        `${outlines[j].title}${outlines[j].sections.map((section) => section.heading).join("")}`,
      );
      worstSimilarity = Math.max(worstSimilarity, jaccard(left, right));
    }
  }

  if (worstSimilarity > 0.72) issues.push("多套大纲的标题与章节骨架过于相似");

  const generic = outlines.flatMap((outline) => outline.sections).filter((section) =>
    GENERIC_HEADING.test(section.heading),
  ).length;
  if (generic > 0) issues.push(`存在 ${generic} 个百科模板式章节标题`);

  const signatures = outlines.map(outlineSkeletonSignature);
  const crashPipeline = signatures.filter(
    (s) => s.includes("crash") && s.includes("cause") && (s.includes("criteria") || s.includes("playbook")),
  );
  if (crashPipeline.length >= 2) {
    issues.push("多套大纲同属「翻车→诱因→标准/清单」流水线");
  }
  const sigCounts = new Map<string, number>();
  for (const sig of signatures) {
    if (!sig) continue;
    sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
  }
  for (const [sig, n] of sigCounts) {
    if (n >= 2) issues.push(`多套大纲修辞骨架相同（${sig}）`);
  }

  const prdHits = outlines.flatMap((o) => o.sections).filter((s) => PRD_SUMMARY_START.test(s.summary.trim())).length;
  if (prdHits >= Math.max(3, outlines.length)) {
    issues.push(`存在 ${prdHits} 处 PRD 腔章节摘要（给出/通过/拆解…）`);
  }

  return {
    score: Math.max(
      0,
      Math.round(
        100 -
          worstSimilarity * 55 -
          generic * 8 -
          crashPipeline.length * 10 -
          Math.max(0, prdHits - 2) * 4,
      ),
    ),
    issues,
  };
}

/** 单套大纲质检：不过关应重抽 */
export function assessSingleOutlineQuality(outline: OutlineOption): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const sections = outline.sections ?? [];
  if (sections.length === 0) issues.push("无章节");

  const genericHeadings = sections.filter((s) => GENERIC_HEADING.test(s.heading)).length;
  if (genericHeadings > 0) issues.push("含百科模板标题");

  const prd = sections.filter((s) => PRD_SUMMARY_START.test((s.summary ?? "").trim())).length;
  if (prd >= Math.ceil(sections.length / 2)) issues.push("过半章节 summary 为 PRD 腔起句");

  // 翻车流水线只在多套对比时拒收（assessOutlineDiversity）；单套允许「真有一次翻车」叙事

  const title = outline.title ?? "";
  if (/实战手册|全面解析|深度剖析/.test(title)) {
    issues.push("标题套话过重");
  }

  return { ok: issues.length === 0, issues };
}

export function isValidOutlineConflict(value: unknown): value is OutlineConflict {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.tension === "string" &&
    c.tension.trim().length >= 8 &&
    typeof c.readerMoment === "string" &&
    c.readerMoment.trim().length >= 4 &&
    typeof c.stake === "string" &&
    c.stake.trim().length >= 4 &&
    typeof c.avoidSkeleton === "string" &&
    c.avoidSkeleton.trim().length >= 4
  );
}
