/**
 * 近作 few-shot 风格盐 + 润色 diff 偏好学习（轻量版）。
 */
import { db } from "@/lib/db";
import {
  getWritingPreferences,
  mergeWritingPreferences,
  parseWritingPreferences,
} from "@/lib/ai/writing-personas";
import { getEnvValue } from "@/lib/config-bridge";

const STYLE_SALT_MAX_CHARS = 720;
const EXCERPT_MAX = 72;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphPlainTexts(html: string): string[] {
  const fromTags =
    html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi)?.map((p) => stripHtml(p)) ?? [];
  if (fromTags.length >= 2) {
    return fromTags.filter((p) => p.length >= 12);
  }
  return stripHtml(html)
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

function clip(text: string, max = EXCERPT_MAX): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function extractStyleExcerpts(html: string): {
  opening: string;
  turn: string;
  ending: string;
} | null {
  const paras = paragraphPlainTexts(html);
  if (paras.length < 2) return null;
  const opening = clip(paras[0] ?? "");
  const ending = clip(paras[paras.length - 1] ?? "");
  const midIdx = Math.floor(paras.length / 2);
  const turn = clip(paras[midIdx] ?? paras[1] ?? "");
  if (!opening || !ending) return null;
  return { opening, turn, ending };
}

/** 从用户近作拼一段风格盐（无历史则空串） */
export async function buildRecentStyleSalt(userId: string): Promise<string> {
  const articles = await db.article.findMany({
    where: {
      userId,
      content: { not: null },
      status: { in: ["generated", "edited", "checked", "pushed"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 4,
    select: { title: true, topic: true, content: true },
  });

  const chunks: string[] = [];
  for (const article of articles) {
    if (!article.content?.trim()) continue;
    const excerpts = extractStyleExcerpts(article.content);
    if (!excerpts) continue;
    const label = (article.title || article.topic || "近作").slice(0, 24);
    chunks.push(
      `《${label}》\n开：${excerpts.opening}\n转：${excerpts.turn}\n收：${excerpts.ending}`,
    );
    if (chunks.join("\n\n").length >= STYLE_SALT_MAX_CHARS) break;
  }

  let salt = chunks.join("\n\n").trim();
  if (salt.length > STYLE_SALT_MAX_CHARS) {
    salt = `${salt.slice(0, STYLE_SALT_MAX_CHARS - 1)}…`;
  }
  return salt;
}

export function buildStyleSaltBlock(salt?: string | null): string {
  const text = (salt ?? getEnvValue("STYLE_SALT") ?? "").trim();
  if (!text) return "";
  return (
    `【近作风格盐（模仿节奏与口吻，禁止抄袭原句/原案例）】\n` +
    `${text}\n` +
    `- 只学句长起伏、转折习惯、收束力度；事实与案例必须服务当前主题`
  );
}

/** 供 withUserConfig 注入 ALS：近作盐（偏好已在 AppConfig） */
export async function loadStyleContextForUser(userId: string): Promise<{
  styleSalt: string;
}> {
  try {
    const styleSalt = await buildRecentStyleSalt(userId);
    return { styleSalt };
  } catch (error) {
    console.warn(
      "[style-salt] load failed:",
      error instanceof Error ? error.message : error,
    );
    return { styleSalt: "" };
  }
}

const LEARN_CLICHES = [
  "赋能",
  "底层逻辑",
  "抓手",
  "闭环",
  "认知升级",
  "值得注意的是",
  "综上所述",
  "总而言之",
  "在当今",
  "随着",
];

function avgSentenceLen(plain: string): number {
  const parts = plain
    .split(/[。！？]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (parts.length === 0) return 0;
  return parts.reduce((a, b) => a + b.length, 0) / parts.length;
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** 从润色前后 diff 启发式抽取偏好规则（不调用 LLM） */
export function extractPreferenceRulesFromDiff(
  beforeHtml: string,
  afterHtml: string,
): string[] {
  const before = stripHtml(beforeHtml);
  const after = stripHtml(afterHtml);
  if (before.length < 40 || after.length < 40) return [];
  if (before === after) return [];

  const rules: string[] = [];

  for (const word of LEARN_CLICHES) {
    if (before.includes(word) && !after.includes(word)) {
      rules.push(`避免使用「${word}」这类套话`);
    }
  }

  const beforeAvg = avgSentenceLen(before);
  const afterAvg = avgSentenceLen(after);
  if (beforeAvg > 0 && afterAvg > 0) {
    if (afterAvg < beforeAvg * 0.85) {
      rules.push("偏好更短的句子与更干脆的收束");
    } else if (afterAvg > beforeAvg * 1.2) {
      rules.push("偏好把关键判断展开说透，不要过度压缩");
    }
  }

  const beforeI = countMatches(before, /我(?:们)?/g);
  const afterI = countMatches(after, /我(?:们)?/g);
  if (afterI >= beforeI + 3 && afterI >= 4) {
    rules.push("可适度使用第一人称经验叙述");
  } else if (beforeI >= 4 && afterI <= beforeI * 0.5) {
    rules.push("少用第一人称，偏客观陈述");
  }

  if (/首先[\s\S]{0,40}其次/.test(before) && !/首先[\s\S]{0,40}其次/.test(after)) {
    rules.push("避免「首先/其次/最后」结构标记");
  }

  if (/让我们来|接下来我们|下面我们来/.test(before) && !/让我们来|接下来我们|下面我们来/.test(after)) {
    rules.push("禁止引导式过渡，直接切入要点");
  }

  const beforeParas = paragraphPlainTexts(beforeHtml);
  const afterParas = paragraphPlainTexts(afterHtml);
  if (beforeParas.length >= 3 && afterParas.length > beforeParas.length + 1) {
    rules.push("偏好更碎的段落层次，避免大段墙式文字");
  }

  return rules.slice(0, 5);
}

/** 润色成功后：合并偏好并写入用户配置 */
export async function learnPreferencesFromPolishDiff(
  userId: string,
  beforeHtml: string,
  afterHtml: string,
): Promise<string[]> {
  const incoming = extractPreferenceRulesFromDiff(beforeHtml, afterHtml);
  if (incoming.length === 0) return [];

  const existingRow = await db.appConfig.findUnique({
    where: {
      userId_configKey: { userId, configKey: "writingPreferences" },
    },
  });
  const existing = parseWritingPreferences(existingRow?.configValue);
  // ALS 里也可能已有本轮加载的偏好
  const fromEnv = getWritingPreferences();
  const merged = mergeWritingPreferences(existing.length ? existing : fromEnv, incoming);

  await db.appConfig.upsert({
    where: {
      userId_configKey: { userId, configKey: "writingPreferences" },
    },
    create: {
      userId,
      configKey: "writingPreferences",
      configValue: JSON.stringify(merged),
    },
    update: { configValue: JSON.stringify(merged) },
  });

  return incoming;
}
