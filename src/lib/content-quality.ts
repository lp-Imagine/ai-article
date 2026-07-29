/**
 * 公众号「低创作度 / 低质 AIGC」启发式检测。
 * 用于风险检测与生成后自检，不替代人工审稿。
 */

export type QualityIssue = {
  code: string;
  message: string;
  severity: "high" | "medium" | "low";
};

export type FactualFinding = {
  code: string;
  excerpt: string;
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

/** 常见非人名词，避免把「我们」「系统」等误判为人名 */
const NAME_BLOCKLIST = new Set([
  "中国", "大家", "我们", "他们", "她们", "你们", "什么", "自己", "可以", "需要", "已经",
  "一个", "一种", "第一", "第二", "这个", "那个", "如何", "怎么", "为什么", "如果", "但是",
  "所以", "因为", "虽然", "不过", "然后", "最后", "其实", "可能", "应该", "必须", "一定",
  "非常", "比较", "真正", "关键", "重要", "问题", "方法", "方案", "系统", "模型", "接口",
  "数据", "用户", "团队", "内容", "客户", "服务", "主管", "经理", "工程师", "开发", "产品",
  "运营", "市场", "技术", "业务", "平台", "公司", "部门", "项目", "文章", "读者", "作者",
  "今天", "昨天", "上周", "本月", "今年", "当时", "后来", "之前", "之后", "同时", "另外",
  "比如", "例如", "总结", "结论", "建议", "注意", "常见", "一般", "通常", "往往", "容易",
]);

function excerptAround(text: string, index: number, len: number, radius = 24): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + len + radius);
  const slice = text.slice(start, end).trim();
  return (start > 0 ? "…" : "") + slice + (end < text.length ? "…" : "");
}

function isLikelyPersonName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 3) return false;
  if (NAME_BLOCKLIST.has(name)) return false;
  if (/^[一二三四五六七八九十\d]+/.test(name)) return false;
  if (/^(小|老|大)/.test(name) && name.length === 2) return true;
  // 常见姓氏 + 1-2 字名
  const surnames =
    "张王李赵刘陈杨黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤";
  if (surnames.includes(name[0]) && name.length >= 2) return true;
  return false;
}

function pushUniqueFinding(
  findings: FactualFinding[],
  seen: Set<string>,
  finding: FactualFinding,
) {
  const key = `${finding.code}|${finding.excerpt}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

/** 扫描正文中可能无法核验的具体事实（人名、精确数字、公司名等） */
export function analyzeFactualClaims(plain: string): FactualFinding[] {
  const findings: FactualFinding[] = [];
  const seen = new Set<string>();

  // 具体人名
  const namePatterns: Array<{ re: RegExp; label: string }> = [
    { re: /(?:叫|名叫|名为)([\u4e00-\u9fa5]{2,3})/g, label: "具名人物" },
    { re: /(?:同事|朋友|学员|读者|用户|客户|主管|经理)([\u4e00-\u9fa5]{2,3})/g, label: "角色+姓名" },
    { re: /([\u4e00-\u9fa5]{2,3})(?:说|表示|告诉|回复|抱怨|发现|决定|提出)/g, label: "人物动作" },
    { re: /[\u4e00-\u9fa5]{1,8}的([\u4e00-\u9fa5]{2,3})(?=[，,。在把被让给对向]|$)/g, label: "所属+姓名" },
  ];
  for (const { re, label } of namePatterns) {
    for (const m of plain.matchAll(re)) {
      const name = m[1];
      if (!isLikelyPersonName(name)) continue;
      pushUniqueFinding(findings, seen, {
        code: "named_person",
        excerpt: excerptAround(plain, m.index ?? 0, m[0].length),
        message: `疑似虚构具名人物「${name}」（${label}），无来源时请改为匿名角色`,
        severity: "high",
      });
    }
  }

  // 具体公司/机构（排除「某公司」「某团队」等匿名写法）
  for (const m of plain.matchAll(
    /(?<![某某])[\u4e00-\u9fa5]{2,10}(?:科技|网络|信息|软件|有限公司|集团|互联网公司|研究院|实验室)/g,
  )) {
    pushUniqueFinding(findings, seen, {
      code: "named_company",
      excerpt: excerptAround(plain, m.index ?? 0, m[0].length),
      message: `出现具体机构名「${m[0]}」，请确认可公开引用或改为匿名`,
      severity: "medium",
    });
  }

  // 精确百分比（≥2 处更可疑）
  const pctMatches = [...plain.matchAll(/\d+(?:\.\d+)?%/g)];
  for (const m of pctMatches.slice(0, 6)) {
    pushUniqueFinding(findings, seen, {
      code: "precise_percentage",
      excerpt: excerptAround(plain, m.index ?? 0, m[0].length),
      message: `精确百分比「${m[0]}」若无数据来源，建议改为区间或删除`,
      severity: pctMatches.length >= 2 ? "high" : "medium",
    });
  }

  // 金额
  for (const m of plain.matchAll(/\d+(?:\.\d+)?(?:万|亿)?元|¥\s?\d+(?:\.\d+)?/g)) {
    pushUniqueFinding(findings, seen, {
      code: "precise_money",
      excerpt: excerptAround(plain, m.index ?? 0, m[0].length),
      message: `精确金额「${m[0]}」请确认可核验，否则改为「约」「左右」`,
      severity: "medium",
    });
  }

  // 具体日期/时间点
  for (const m of plain.matchAll(
    /20\d{2}年(?:\d{1,2}月)?(?:\d{1,2}日)?|\d{1,2}月\d{1,2}日|上周[一二三四五六日天]|(?:昨|今|前)天|三天后|两个月后|第[一二三四五六七八九十\d]+天/g,
  )) {
    pushUniqueFinding(findings, seen, {
      code: "precise_date",
      excerpt: excerptAround(plain, m.index ?? 0, m[0].length),
      message: `具体时间「${m[0]}」若无真实事件支撑，建议模糊化`,
      severity: "medium",
    });
  }

  // 性能/指标精确数字（P50/P99、X秒、Xms）
  for (const m of plain.matchAll(/P\d{2,3}(?:\s*延迟|\s*时延)?|\d+(?:\.\d+)?\s*(?:秒|ms|毫秒)(?:的延迟|时延|内)?/gi)) {
    pushUniqueFinding(findings, seen, {
      code: "precise_metric",
      excerpt: excerptAround(plain, m.index ?? 0, m[0].length),
      message: `精确指标「${m[0]}」若无实测数据，建议改为区间或删除`,
      severity: "high",
    });
  }

  // 对话引用（「他说…」「张磊说…」类）
  for (const m of plain.matchAll(/[「『""][^」』""]{4,40}[」』""]/g)) {
    const quote = m[0];
    const before = plain.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    if (/说|问|答|回|讲|吐槽|抱怨/.test(before)) {
      pushUniqueFinding(findings, seen, {
        code: "quoted_dialogue",
        excerpt: excerptAround(plain, m.index ?? 0, m[0].length),
        message: "疑似虚构对话引用，无采访来源时请改为间接叙述",
        severity: "medium",
      });
    }
  }

  return findings.slice(0, 12);
}

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
  factualFindings: FactualFinding[];
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
  const factualFindings = analyzeFactualClaims(plain);

  for (const f of factualFindings) {
    issues.push({
      code: f.code,
      message: f.message,
      severity: f.severity,
    });
  }

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

  const suggestions = buildSuggestions(issues, factualFindings);
  return { issues, factualFindings, score, suggestions, plainLength: plain.length, clicheHits };
}

function buildSuggestions(issues: QualityIssue[], factualFindings: FactualFinding[]): string[] {
  const suggestions: string[] = [];
  const codes = new Set(issues.map((i) => i.code));

  const factualCodes = new Set(factualFindings.map((f) => f.code));
  if (factualCodes.has("named_person") || factualCodes.has("quoted_dialogue")) {
    suggestions.push("将具体人名改为匿名角色（如「某内容团队负责人」），避免读者误以为是真实人物");
  }
  if (
    factualCodes.has("precise_percentage") ||
    factualCodes.has("precise_metric") ||
    factualCodes.has("precise_money")
  ) {
    suggestions.push("精确数字若无来源，改为区间/量级（如「约三成」「近 2 秒」）或直接删除");
  }
  if (factualCodes.has("named_company") || factualCodes.has("precise_date")) {
    suggestions.push("公司名、日期等细节若无出处，请匿名化或模糊化后再发布");
  }

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
    suggestions.push("未发现明显低质或事实风险信号；仍建议人工核对案例真实性后再推送");
  }
  return suggestions;
}

export function qualityIssuesToMessages(issues: QualityIssue[]): string[] {
  return issues.map((i) => i.message);
}
