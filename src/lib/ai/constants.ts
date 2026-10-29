/**
 * AI 模块的纯常量（无副作用、与运行时配置无关）。
 * 把它们从 ai.ts 拆出来，便于阅读与复用。
 */

/** 正文生成时单次章节的最大重试次数 */
export const SECTION_ATTEMPTS = 3;

/** 整理格式时单次请求的纯文本字符上限（避免上游截断） */
export const REFORMAT_CHUNK_PLAIN_CHARS = 1800;

/** 精炼 / 扩写时块间分隔符的正则（由代码维护，模型改写时保留） */
export const TRAILING_HR = /(?:\s*<hr\s*\/?>)+\s*$/i;

/**
 * 大纲差异化「盐粒」——软提示，不是强制角名。
 * 成稿时优先使用两阶段挖出的 conflict；此处仅在冲突发现失败时作后备盐。
 */
export const OUTLINE_SEED_HINTS = [
  "从一个读者马上要做的具体决定写起，而不是先讲概念",
  "把两种常见做法放在同一张取舍桌上，写清适用边界",
  "只承诺一个最小可完成切片，其余明确标成以后再说",
  "按一次真实时间线复盘关键分叉，而不是并列三大要点",
  "先钉住一个会被当成常识的错法，再给可核对的对照",
  "用「这篇故意不覆盖什么」收束边界，避免百科式求全",
];

/** @deprecated 使用 OUTLINE_SEED_HINTS；保留别名以免外部引用断裂 */
export const OUTLINE_ANGLES = OUTLINE_SEED_HINTS;
