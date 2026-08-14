import type { QualityIssue } from "@/lib/content-quality";
import { REFINE_PROMPT_VERSION } from "@/lib/ai/prompts/refine";
import type { SkillDefinition } from "@/lib/ai/skills/types";

export const REFINE_SKILL: SkillDefinition = {
  name: "quality-repair",
  version: REFINE_PROMPT_VERSION,
  description: "根据检测出的空洞、重复、AI 套话和事实风险做定向终审。",
};

export function buildQualityRepairBrief(input: {
  issues: QualityIssue[];
  suggestions: string[];
}): string {
  const issueLines = input.issues
    .slice(0, 8)
    .map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}`);
  const suggestionLines = input.suggestions.slice(0, 6).map((item) => `- ${item}`);
  if (issueLines.length === 0 && suggestionLines.length === 0) return "";
  return `【本稿定向修复清单】
${issueLines.join("\n")}
${suggestionLines.join("\n")}
只修复清单命中的问题；不要把整篇改回统一的 AI 教科书语气。`;
}
