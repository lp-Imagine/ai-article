import { z } from "zod";

/** 半截/叠字中文，不能进生图文案 */
const BAD_ZH_FRAGMENT = /词词|案案|类类|标题设计|(.)\1{2,}/u;

function looksLikeCompleteShortZh(value: string, maxLen: number): boolean {
  const t = value.replace(/\s+/g, "").trim();
  if (!t || t.length > maxLen) return false;
  if (BAD_ZH_FRAGMENT.test(t)) return false;
  return true;
}

const sectionBeatSchema = z.object({
  visual: z.string().trim().min(1).max(160),
  label: z
    .string()
    .trim()
    .max(12)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

/**
 * 章节配图分镜：LLM JSON 结构校验。
 * 通过后再走 normalize（截断/补齐）；失败则整段丢弃走本地 fallback。
 */
export const sectionStoryboardLlmSchema = z
  .object({
    mode: z
      .enum(["hero", "duo", "trio-short", "trio-icons", "trio"])
      .optional()
      .catch(undefined),
    title: z.string().trim().max(40).optional().catch(undefined),
    scene: z.string().trim().max(400).optional().catch(""),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((s) => looksLikeCompleteShortZh(s, 40), "summary looks truncated/noisy"),
    beats: z.array(sectionBeatSchema).max(4).optional().catch([]),
    /** 兼容旧输出 */
    panels: z
      .array(
        z.object({
          visual: z.string().optional(),
          label: z.string().optional(),
        }),
      )
      .max(4)
      .optional()
      .catch(undefined),
  })
  .refine(
    (data) =>
      Boolean(data.scene?.trim()) ||
      (data.beats && data.beats.length > 0) ||
      (data.panels && data.panels.length > 0),
    "need scene or beats",
  );

export type SectionStoryboardLlm = z.infer<typeof sectionStoryboardLlmSchema>;

/** 封面生图 prompt：LLM JSON */
export const coverPromptLlmSchema = z.object({
  prompt: z.string().trim().min(1).max(2000).optional(),
  subtitle: z
    .string()
    .trim()
    .max(30)
    .optional()
    .refine(
      (s) => s == null || s === "" || (!BAD_ZH_FRAGMENT.test(s) && s.length <= 14),
      "subtitle invalid",
    ),
  keywords: z.array(z.string().trim().min(1).max(16)).max(8).optional(),
});

export type CoverPromptLlm = z.infer<typeof coverPromptLlmSchema>;

/** 标题候选 */
export const titlesLlmSchema = z.object({
  titles: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(80),
        style: z.string().trim().max(40).optional().catch("备选"),
      }),
    )
    .min(1)
    .max(12),
});

/** 摘要 */
export const summaryLlmSchema = z.object({
  summary: z.string().trim().min(1).max(500),
});

/**
 * 解析 LLM 返回的 JSON 字符串并用 Zod 校验。
 * 失败返回 null（调用方走 fallback）。
 */
export function parseLlmJson<T>(
  schema: z.ZodType<T>,
  raw: string | null | undefined,
): T | null {
  if (!raw || !raw.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // 偶发被包在 markdown fence 里
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (!fenced) return null;
    try {
      data = JSON.parse(fenced);
    } catch {
      return null;
    }
  }
  const result = schema.safeParse(data);
  if (!result.success) return null;
  return result.data;
}
