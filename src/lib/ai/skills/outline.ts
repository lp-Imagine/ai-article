import type { OutlineOption } from "@/types/article";
import { OUTLINE_ANGLES } from "@/lib/ai/constants";
import { OUTLINE_PROMPT_VERSION } from "@/lib/ai/prompts/outline";
import type { SkillDefinition } from "@/lib/ai/skills/types";

export const OUTLINE_SKILL: SkillDefinition = {
  name: "outline-strategy",
  version: OUTLINE_PROMPT_VERSION,
  description: "为同一主题生成结构、论证路径和交付物均不同的大纲。",
};

export function outlineAngleAt(index: number): string {
  return OUTLINE_ANGLES[index % OUTLINE_ANGLES.length];
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
    /^(什么是|为什么重要|方法论|注意事项|总结与展望)/.test(section.heading),
  ).length;
  if (generic > 0) issues.push(`存在 ${generic} 个百科模板式章节标题`);

  return {
    score: Math.max(0, Math.round(100 - worstSimilarity * 55 - generic * 8)),
    issues,
  };
}
