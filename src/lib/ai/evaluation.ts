import type { OutlineOption } from "@/types/article";
import { assessOutlineDiversity } from "@/lib/ai/skills/outline";

const CLICHES = [
  "在当今",
  "随着",
  "赋能",
  "抓手",
  "闭环",
  "底层逻辑",
  "认知升级",
  "众所周知",
  "值得注意的是",
];

const GENERIC_HEADING = /^(?:什么是|为什么.*重要|.*的重要性|方法论|注意事项|总结与展望|未来展望)/;
const OPENING_TEMPLATES = [
  /在当今.{0,30}(?:时代|社会)/,
  /随着.{0,30}(?:发展|普及)/,
  /(?:最近|上周).{0,12}(?:朋友|同事|读者).{0,12}(?:问|说|聊天)/,
  /众所周知/,
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s，。！？：；、,.!?:;（）()【】\[\]《》]/g, "");
}

function ngrams(text: string, size = 2): Set<string> {
  const value = normalize(text);
  const result = new Set<string>();
  for (let i = 0; i <= value.length - size; i += 1) {
    result.add(value.slice(i, i + size));
  }
  return result;
}

function similarity(left: string, right: string): number {
  const a = ngrams(left);
  const b = ngrams(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function extractMatches(html: string, tag: "h2" | "h3" | "p"): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...html.matchAll(re)].map((match) => stripHtml(match[1])).filter(Boolean);
}

function hasConcreteSignal(paragraph: string): boolean {
  return (
    /\d/.test(paragraph) ||
    /[A-Za-z]{2,}/.test(paragraph) ||
    /例如|比如|步骤|对比|如果|报错|界面|字段|命令|清单|边界|前提|反例|核对|要求|查看|授权|拍摄|记录|日期|金额|通知|支付/.test(
      paragraph,
    )
  );
}

export type PromptEvaluation = {
  clicheHits: number;
  genericHeadingCount: number;
  headingTitleSimilarity: number;
  lowDensityParagraphRate: number;
  repeatedParagraphRate: number;
  openingTemplateMatches: number;
  outlineDiversityScore: number | null;
};

export function evaluateArticle(input: {
  title: string;
  content: string;
  outlines?: OutlineOption[];
}): PromptEvaluation {
  const plain = stripHtml(input.content);
  const headings = [
    ...extractMatches(input.content, "h2"),
    ...extractMatches(input.content, "h3"),
  ];
  const paragraphs = extractMatches(input.content, "p").filter((item) => item.length >= 20);
  const normalizedParagraphs = paragraphs.map(normalize).filter((item) => item.length >= 16);
  const uniqueParagraphs = new Set(normalizedParagraphs);
  const lowDensity = paragraphs.filter((paragraph) => !hasConcreteSignal(paragraph)).length;
  const opening = plain.slice(0, 180);
  const diversity = input.outlines?.length
    ? assessOutlineDiversity(input.outlines).score
    : null;

  return {
    clicheHits: CLICHES.reduce(
      (total, phrase) => total + plain.split(phrase).length - 1,
      0,
    ),
    genericHeadingCount: headings.filter((heading) => GENERIC_HEADING.test(heading)).length,
    headingTitleSimilarity: Number(
      (headings.length
        ? headings.reduce((total, heading) => total + similarity(input.title, heading), 0) /
          headings.length
        : 0
      ).toFixed(3),
    ),
    lowDensityParagraphRate: Number(
      (paragraphs.length ? lowDensity / paragraphs.length : 0).toFixed(3),
    ),
    repeatedParagraphRate: Number(
      (normalizedParagraphs.length
        ? 1 - uniqueParagraphs.size / normalizedParagraphs.length
        : 0
      ).toFixed(3),
    ),
    openingTemplateMatches: OPENING_TEMPLATES.filter((pattern) => pattern.test(opening)).length,
    outlineDiversityScore: diversity,
  };
}
