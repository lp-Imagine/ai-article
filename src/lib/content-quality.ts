/**
 * 公众号「低创作度 / 低质 AIGC」启发式检测。
 * 用于风险检测与生成后自检，不替代人工审稿。
 */

export type QualityIssue = {
  code: string;
  message: string;
  severity: "high" | "medium" | "low";
};

const AI_CLICHES: Array<{ word: string; weight: number }> = [
  { word: "在当今", weight: 3 },
  { word: "随着", weight: 2 },
  { word: "赋能", weight: 3 },
  { word: "抓手", weight: 3 },
  { word: "闭环", weight: 2 },
  { word: "底层逻辑", weight: 3 },
  { word: "降维", weight: 2 },
  { word: "颗粒度", weight: 3 },
  { word: "对齐认知", weight: 3 },
  { word: "沉淀方法论", weight: 3 },
  { word: "打造闭环", weight: 3 },
  { word: "深度思考", weight: 2 },
  { word: "本质上是", weight: 2 },
  { word: "认知升级", weight: 3 },
  { word: "体系化", weight: 2 },
  { word: "方法论", weight: 1 },
  { word: "值得注意的是", weight: 2 },
  { word: "不可否认", weight: 2 },
  { word: "众所周知", weight: 3 },
  { word: "毋庸置疑", weight: 3 },
  { word: "在这个时代", weight: 3 },
  { word: "新的篇章", weight: 3 },
  { word: "踏上新征程", weight: 3 },
];

const EMPTY_FILLERS = [
  "真正的问题是",
  "关键在于",
  "核心在于",
  "归根结底",
  "说到底",
  "其实很简单",
  "并不复杂",
  "只需要记住",
  "最重要的是态度",
  "方向对了",
  "持续优化",
  "不断迭代",
  "长期主义",
  "小步快跑",
];

const CHATTY_OPENERS = [
  /和一个朋友聊天/,
  /和朋友聊天/,
  /同事问我/,
  /有读者留言/,
  /上周有人问我/,
  /最近有朋友问/,
  /他说最近在.{0,20}进展却不大/,
  /方向对但顺序/,
];

const ABSOLUTE_WORDS = ["绝对", "100%", "包过", "稳赚", "唯一选择", "一定要", "必须立刻", "史上最"];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

/** 段落信息密度粗估：过短或过长且无具体信号的段落 */
function estimateLowDensityParagraphs(plainParagraphs: string[]): number {
  let low = 0;
  for (const p of plainParagraphs) {
    if (p.length < 20) continue;
    const hasConcrete =
      /\d/.test(p) ||
      /[「『"“].{2,40}[」』"”]/.test(p) ||
      /比如|例如|当时|报错|步骤|首先|然后|如果|会发现|对比|之前|之后/.test(p) ||
      /[A-Za-z]{2,}/.test(p);
    const isVague =
      /本质上|认知|体系|赋能|闭环|方法论|重要|关键|真正/.test(p) && !hasConcrete;
    if (isVague || (p.length > 80 && !hasConcrete && /我们|大家|人们/.test(p))) {
      low += 1;
    }
  }
  return low;
}

export function analyzeContentQuality(input: {
  title?: string | null;
  summary?: string | null;
  content?: string | null;
}): {
  issues: QualityIssue[];
  score: number;
  suggestions: string[];
  plainLength: number;
  clicheHits: number;
} {
  const title = input.title?.trim() ?? "";
  const summary = input.summary?.trim() ?? "";
  const contentHtml = input.content?.trim() ?? "";
  const plain = stripHtml(`${title}\n${summary}\n${contentHtml}`);
  const issues: QualityIssue[] = [];

  if (plain.length < 400) {
    issues.push({
      code: "too_short",
      message: "正文过短，信息量不足，易被判定为低质内容",
      severity: "high",
    });
  }

  let clicheHits = 0;
  const hitWords: string[] = [];
  for (const { word, weight } of AI_CLICHES) {
    const n = countOccurrences(plain, word);
    if (n > 0) {
      clicheHits += n * weight;
      hitWords.push(`${word}×${n}`);
    }
  }
  if (clicheHits >= 4) {
    issues.push({
      code: "ai_cliche",
      message: `疑似 AI 套话偏多（${hitWords.slice(0, 6).join("、")}）`,
      severity: clicheHits >= 8 ? "high" : "medium",
    });
  }

  let fillerHits = 0;
  for (const f of EMPTY_FILLERS) {
    fillerHits += countOccurrences(plain, f);
  }
  if (fillerHits >= 3) {
    issues.push({
      code: "empty_filler",
      message: `空洞过渡句偏多（约 ${fillerHits} 处），信息密度偏低`,
      severity: fillerHits >= 5 ? "high" : "medium",
    });
  }

  const opening = plain.slice(0, 180);
  for (const re of CHATTY_OPENERS) {
    if (re.test(opening)) {
      issues.push({
        code: "chatty_opener",
        message: "开篇像「闲聊代入」模板，同质化风险高",
        severity: "high",
      });
      break;
    }
  }

  for (const word of ABSOLUTE_WORDS) {
    if (plain.includes(word)) {
      issues.push({
        code: "absolute_claim",
        message: `包含绝对化表述：「${word}」`,
        severity: "medium",
      });
    }
  }

  const longParagraphs = (contentHtml || plain)
    .split(/\n+/)
    .map((p) => stripHtml(p).trim())
    .filter((p) => p.length > 400);
  if (longParagraphs.length > 0) {
    issues.push({
      code: "long_paragraph",
      message: `有 ${longParagraphs.length} 段过长，不利于阅读与信息层次`,
      severity: "low",
    });
  }

  const paragraphs = plain
    .split(/[。！？\n]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 25);
  const lowDensity = estimateLowDensityParagraphs(paragraphs);
  if (paragraphs.length >= 6 && lowDensity / paragraphs.length >= 0.35) {
    issues.push({
      code: "low_density",
      message: `约 ${Math.round((lowDensity / paragraphs.length) * 100)}% 句子缺少具体细节，易被判「内容空洞」`,
      severity: "high",
    });
  }

  // 教科书同质骨架信号
  const skeletonHits = [
    /什么是/,
    /的重要性/,
    /注意事项/,
    /总结与展望/,
    /未来展望/,
    /三大(?:误区|步骤|方法)/,
  ].filter((re) => re.test(plain)).length;
  if (skeletonHits >= 2) {
    issues.push({
      code: "homogeneous_skeleton",
      message: "结构像「定义→重要性→方法→注意→总结」通用骨架，创作度偏低",
      severity: "medium",
    });
  }

  // 重复句式：同一句开头多次出现
  const starts = paragraphs
    .map((p) => p.slice(0, 8))
    .filter((s) => s.length >= 4);
  const startCounts = new Map<string, number>();
  for (const s of starts) startCounts.set(s, (startCounts.get(s) ?? 0) + 1);
  const repeatedStarts = [...startCounts.entries()].filter(([, n]) => n >= 3);
  if (repeatedStarts.length > 0) {
    issues.push({
      code: "repetitive_rhythm",
      message: "多段句式高度重复，读感像批量生成",
      severity: "medium",
    });
  }

  const hasCode = /<pre[\s\S]*?<code/i.test(contentHtml);
  const looksEngineering =
    /代码|封装|组件|接口|API|TypeScript|JavaScript|函数|Hook|上传|分片|React|Vue/.test(
      `${title}${summary}${plain}`,
    );
  if (looksEngineering && !hasCode && plain.length > 280) {
    issues.push({
      code: "missing_hands_on",
      message: "工程向主题缺少代码/可粘贴片段，标题承诺可能未兑现",
      severity: "medium",
    });
  }

  const severityWeight = { high: 18, medium: 10, low: 5 };
  let penalty = 0;
  for (const issue of issues) {
    penalty += severityWeight[issue.severity];
  }
  // 套话额外扣分
  penalty += Math.min(20, Math.floor(clicheHits * 1.5));

  const score = Math.max(20, Math.min(100, 100 - penalty));

  const suggestions = buildSuggestions(issues);
  return { issues, score, suggestions, plainLength: plain.length, clicheHits };
}

function buildSuggestions(issues: QualityIssue[]): string[] {
  const suggestions: string[] = [];
  const codes = new Set(issues.map((i) => i.code));

  if (codes.has("ai_cliche") || codes.has("empty_filler")) {
    suggestions.push("删掉套话与正确废话，改成具体场景、数字、步骤或代码");
  }
  if (codes.has("chatty_opener")) {
    suggestions.push("开篇直接点题：问题、结论或一个可核对的现象，不要虚构闲聊");
  }
  if (codes.has("low_density") || codes.has("too_short")) {
    suggestions.push("每段保证一个信息增量：读者读完能多会做/多知道一件事");
  }
  if (codes.has("homogeneous_skeleton")) {
    suggestions.push("换切入角：先翻车后正解、对比选型、最小可用切片，避免百科目录");
  }
  if (codes.has("absolute_claim")) {
    suggestions.push("将绝对化词汇换成可验证描述（常见情况、适用条件、边界）");
  }
  if (codes.has("long_paragraph")) {
    suggestions.push("把过长段落拆成 2 段以上，一句一个重点");
  }
  if (codes.has("missing_hands_on")) {
    suggestions.push("补上可运行/可粘贴的代码或逐步操作，兑现「实战/手册」承诺");
  }
  if (codes.has("repetitive_rhythm")) {
    suggestions.push("打乱段首句式，长短句交替，避免模板排比");
  }
  if (suggestions.length === 0) {
    suggestions.push("未发现明显低质信号；仍建议人工核对事实与案例真实性后再推送");
  }
  return suggestions;
}

export function qualityIssuesToMessages(issues: QualityIssue[]): string[] {
  return issues.map((i) => i.message);
}
