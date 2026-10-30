/**
 * 写作人格预设（对标 WeWrite personas，精简为 3 套）。
 * 只影响语气、证据呈现与情绪浓度；不覆盖主题领域。
 */
import { getEnvValue } from "@/lib/config-bridge";

export type WritingPersonaId = "notes" | "sharp" | "warm";

export type WritingPersona = {
  id: WritingPersonaId;
  label: string;
  blurb: string;
  /** 注入 system prompt 的约束块（不含标题壳） */
  voiceRules: string[];
};

export const WRITING_PERSONAS: Record<WritingPersonaId, WritingPersona> = {
  notes: {
    id: "notes",
    label: "干货笔记",
    blurb: "高信息密度，步骤与边界清楚，少情绪铺陈",
    voiceRules: [
      "像自己写给同事的笔记：判断先行，步骤具体，少抒情",
      "证据偏好：检查清单、边界条件、可粘贴片段、前后对比",
      "段末常落一句可执行下一步；少用漫长情绪弧",
      "不确定性用「常见情况 / 适用条件」表达，不装全知",
    ],
  },
  sharp: {
    id: "sharp",
    label: "锐评观察",
    blurb: "态度鲜明、句子干脆，数据与代价先于鸡汤",
    voiceRules: [
      "开篇尽快亮出态度句；全文服务一个可反驳的判断",
      "证据偏好：反例、代价、对比选型、可核对现象",
      "句子偏短；允许刺一点，但每个刺都要有依据",
      "少用温暖共情铺垫；不要写成成功学动员",
    ],
  },
  warm: {
    id: "warm",
    label: "温暖叙事",
    blurb: "场景带动判断，语气亲近，情绪弧柔和但不空",
    voiceRules: [
      "用具体场景与人物动作带出判断，再给可带走的结论",
      "证据偏好：匿名可核对场景、前后对比、一句体感",
      "允许适度第一人称与留白；仍须有信息增量，禁止纯鸡汤",
      "收束偏温和，可写「这篇没覆盖什么」，忌硬卖焦虑",
    ],
  },
};

export const WRITING_PERSONA_IDS = Object.keys(WRITING_PERSONAS) as WritingPersonaId[];

export function isWritingPersonaId(value: unknown): value is WritingPersonaId {
  return typeof value === "string" && value in WRITING_PERSONAS;
}

export function getWritingPersonaId(): WritingPersonaId {
  const raw = getEnvValue("WRITING_PERSONA")?.trim();
  return isWritingPersonaId(raw) ? raw : "notes";
}

export function getWritingPersona(): WritingPersona {
  return WRITING_PERSONAS[getWritingPersonaId()];
}

export function buildWritingPersonaBlock(): string {
  const persona = getWritingPersona();
  return (
    `【写作人格：${persona.label}】\n` +
    persona.voiceRules.map((r) => `- ${r}`).join("\n") +
    `\n- 人格只调口吻与证据呈现；**主题与领域仍由用户选题决定**`
  );
}

export function parseWritingPreferences(raw?: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string" && x.trim().length >= 4)
      .map((x) => x.trim().slice(0, 80))
      .slice(0, 8);
  } catch {
    return raw
      .split(/\n|；|;/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4)
      .slice(0, 8);
  }
}

export function getWritingPreferences(): string[] {
  return parseWritingPreferences(getEnvValue("WRITING_PREFERENCES"));
}

export function buildWritingPreferencesBlock(): string {
  const prefs = getWritingPreferences();
  if (prefs.length === 0) return "";
  return (
    `【从你历史润色学到的偏好（软约束）】\n` +
    prefs.map((p) => `- ${p}`).join("\n") +
    `\n- 与去 AI 腔、主题边界冲突时，以后者为准`
  );
}

export function mergeWritingPreferences(
  existing: string[],
  incoming: string[],
  max = 8,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rule of [...incoming, ...existing]) {
    const key = rule.replace(/\s/g, "").slice(0, 28);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(rule.slice(0, 80));
    if (out.length >= max) break;
  }
  return out;
}
