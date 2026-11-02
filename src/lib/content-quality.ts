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

const ABSOLUTE_WORDS = [
  "绝对",
  "100%",
  "包过",
  "稳赚",
  "唯一选择",
  "一定要",
  "必须立刻",
  "史上最",
  "彻底切断",
  "彻底解决",
  "接近100%",
  "无任何越权",
  "零风险",
];

/** 营销/合规口径里的假精确数字语境 */
const MARKETING_METRIC_CTX =
  /泄露|审计|通过率|冗余|隔离|合规|等保|风险|隐患|实测数据|匿名.*集群|跨角色/;

function isTechMetricContext(window: string): boolean {
  return /P\d{2,3}|吞吐|延迟|压测|req\/s|\bms\b|QPS|缓存命中|CPU|内存|模型/i.test(window);
}

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

/** 去掉误捕的助词尾巴，如「林薇把」→「林薇」 */
function normalizeCapturedName(raw: string): string {
  return raw.replace(/[把被让给在对向与了过着将会要很]+$/u, "").trim();
}

function isLikelyPersonName(name: string): boolean {
  const normalized = normalizeCapturedName(name);
  if (!normalized || normalized.length < 2 || normalized.length > 3) return false;
  if (NAME_BLOCKLIST.has(normalized)) return false;
  if (/^[一二三四五六七八九十\d]+/.test(normalized)) return false;
  if (/^(小|老|大)/.test(normalized) && normalized.length === 2) return true;
  const surnames =
    "张王李赵刘陈杨黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤";
  if (surnames.includes(normalized[0]) && normalized.length >= 2) return true;
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
    { re: /(?:同事|朋友|学员|读者|用户|客户|主管|经理)([\u4e00-\u9fa5]{2})(?=[把被让给在对向，,。!\s]|$)/g, label: "角色+姓名" },
    { re: /([\u4e00-\u9fa5]{2})(?=[说表示告诉回复抱怨发现决定提出])/g, label: "人物动作" },
    { re: /[\u4e00-\u9fa5]{1,8}的([\u4e00-\u9fa5]{2})(?=[，,。在把被让给对向]|$)/g, label: "所属+姓名" },
  ];
  for (const { re, label } of namePatterns) {
    for (const m of plain.matchAll(re)) {
      const name = normalizeCapturedName(m[1]);
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

  // 精确百分比：营销/合规语境一律高风险；仅明确「命中率/CPU」等技术口径可跳过
  const pctMatches = [...plain.matchAll(/\d+(?:\.\d+)?%/g)];
  for (const m of pctMatches.slice(0, 8)) {
    const idx = m.index ?? 0;
    const window = plain.slice(Math.max(0, idx - 28), idx + m[0].length + 20);
    const techPercent =
      /缓存命中|命中率|CPU|GPU|内存占用|错误率|成功率/.test(window) &&
      !MARKETING_METRIC_CTX.test(window) &&
      !/成本|涨了|降了|客诉/.test(window);
    if (techPercent) continue;
    const marketing = MARKETING_METRIC_CTX.test(window);
    pushUniqueFinding(findings, seen, {
      code: "precise_percentage",
      excerpt: excerptAround(plain, idx, m[0].length),
      message: marketing
        ? `无出处的营销/合规百分比「${m[0]}」（如泄露率/通过率），请删除或改成定性描述`
        : `精确百分比「${m[0]}」若无数据来源，建议改为量级或删除`,
      severity: marketing || pctMatches.length >= 2 ? "high" : "medium",
    });
  }

  // 「匿名集群实测 / 接近100% / 降低90%以上」类假调研腔
  for (const m of plain.matchAll(
    /(?:某)?匿名[^。]{0,12}(?:集群|团队)?[^。]{0,8}实测|接近\s*100\s*%|降低\s*\d+\s*%\s*以上|通过率\s*(?:仅|约)?\s*\d+\s*%|隔离效果为接近/g,
  )) {
    pushUniqueFinding(findings, seen, {
      code: "fabricated_metric_claim",
      excerpt: excerptAround(plain, m.index ?? 0, m[0].length),
      message: `疑似编造调研/达标口径「${m[0]}」，无来源时请删掉数字改定性`,
      severity: "high",
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

  // 性能时长：靠近分位数/吞吐/压测语境的视为技术对比，不标风险
  for (const m of plain.matchAll(/\d+(?:\.\d+)?\s*秒/g)) {
    const idx = m.index ?? 0;
    const window = plain.slice(Math.max(0, idx - 24), idx + m[0].length + 16);
    if (/P\d{2,3}|吞吐|延迟|压测|req\/s|ms|模型/i.test(window)) continue;
    pushUniqueFinding(findings, seen, {
      code: "precise_metric",
      excerpt: excerptAround(plain, idx, m[0].length),
      message: `精确时长「${m[0]}」若无实测数据，建议改为区间或删除`,
      severity: "medium",
    });
  }

  // 对话引用（「他说…」「张磊说…」类）
  for (const m of plain.matchAll(/[「『""][^」』""]{4,40}[」』""]/g)) {
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

/** 将正文中的具名人物改为匿名表达（生成后兜底；不改写技术指标/百分比） */
export function sanitizeFactualPlainText(text: string): { text: string; changed: boolean } {
  let changed = false;
  let out = text;

  const apply = (re: RegExp, replacer: string | ((substring: string, ...args: unknown[]) => string)) => {
    const next = out.replace(re, replacer as Parameters<typeof out.replace>[1]);
    if (next !== out) changed = true;
    out = next;
  };

  apply(/(?<![某])主管[\u4e00-\u9fa5]{2}(?=[把被在给对，,。\s])/g, "某主管");
  apply(/(?<![某])经理[\u4e00-\u9fa5]{2}(?=[把被在给对说，,。\s])/g, "某经理");
  apply(/(?<![某])同事[\u4e00-\u9fa5]{2}(?=[把被在给对说，,。\s])/g, "某同事");
  apply(/(?<![某])朋友[\u4e00-\u9fa5]{2}(?=[把被在给对说，,。\s])/g, "某位朋友");
  apply(/(?:叫|名叫|名为)[\u4e00-\u9fa5]{2,3}/g, "叫某负责人");

  const surnames =
    "张王李赵刘陈杨黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤";
  // 仅在「的/让/… + 姓名 + 把/说」等边界命中，避免「流程把」里的「程…」被误伤
  const nameBoundary = `(?<=^|[的地得了着过与和及对给把被让向从在]|[，,。；;：:\\s「」『』“”‘’（）()【】\\[\\]《》])`;
  apply(
    new RegExp(`${nameBoundary}[${surnames}][\\u4e00-\\u9fa5]{1,2}(?=[说表示告诉回复抱怨])`, "g"),
    "相关负责人",
  );
  apply(new RegExp(`${nameBoundary}[${surnames}][\\u4e00-\\u9fa5]{1,2}把`, "g"), "某负责人把");

  apply(/[^\s，,。]{1,8}[说讲]：[「『"]/g, "团队提到：");

  // 营销/合规语境下的无出处百分比 → 定性（技术对比窗口跳过）
  out = out.replace(/[^。！？\n]{0,36}\d+(?:\.\d+)?%[^。！？\n]{0,24}/g, (chunk) => {
    if (isTechMetricContext(chunk)) return chunk;
    if (!MARKETING_METRIC_CTX.test(chunk) && !/\d+(?:\.\d+)?%\s*[-–—~至到]\s*\d+(?:\.\d+)?%/.test(chunk)) {
      return chunk;
    }
    changed = true;
    return chunk
      .replace(/\d+(?:\.\d+)?%\s*[-–—~至到]\s*\d+(?:\.\d+)?%/g, "不少情况")
      .replace(/(?:接近|高达|仅|约)?\s*\d+(?:\.\d+)?%\s*(?:以上|左右)?/g, "相当一部分");
  });

  apply(/某匿名[^，。]{0,16}(?:实测数据|集群)/g, "团队内部复盘");
  apply(/隔离效果为接近100%/g, "跨角色访问被权限层拦下");
  apply(/无任何越权访问记录/g, "未再观察到同类越权访问");

  return { text: out, changed };
}

export function sanitizeFactualClaimsInHtml(html: string): { content: string; changed: boolean } {
  let changed = false;
  // pre 原样保留；table 也走清洗（营销假百分比常长在对比表里），技术指标窗口会跳过
  const content = html.replace(
    /(<pre[\s\S]*?<\/pre>)|([^<]+)|(<[^>]+>)/gi,
    (full, codeBlock, textPart, tag) => {
      if (codeBlock || tag) return full;
      if (!textPart) return full;
      const { text, changed: c } = sanitizeFactualPlainText(textPart);
      if (c) changed = true;
      return text;
    },
  );
  return { content, changed };
}

/** 短判断句/核心短语是否被多章复读（洞见贴片） */
function countInsightEchoes(plain: string): number {
  const compact = plain.replace(/\s+/g, "");
  const sentences = compact
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 14);

  // 从句子里抽出「判断核」：去掉引导语后取连续 18 字，在全文计数
  const phraseHits = new Map<string, number>();
  for (const s of sentences) {
    const core = s
      .replace(/^这里的核心判断是[：:]/, "")
      .replace(/^[^。]{0,16}再次确认[：:]/, "")
      .replace(/^[^。]{0,10}[：:]/, "");
    if (core.length < 18) continue;
    // 用原文片段检索（勿先删「彻底」，否则匹配不到正文）
    const phrase = core.slice(0, 22);
    if (phraseHits.has(phrase)) continue;
    let hits = 0;
    let from = 0;
    while (from <= compact.length - phrase.length) {
      const at = compact.indexOf(phrase, from);
      if (at < 0) break;
      hits += 1;
      from = at + phrase.length;
    }
    if (hits >= 2) phraseHits.set(phrase, hits);
  }

  let echoes = 0;
  for (const hits of phraseHits.values()) {
    echoes += hits - 1;
  }
  return echoes;
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

/** 强具体信号：去掉「如果/然后」等弱连接词 */
function hasConcreteSignal(text: string): boolean {
  return (
    /\d/.test(text) ||
    /[「『"“].{2,40}[」』"”]/.test(text) ||
    /比如|例如|当时|报错|步骤|会发现|对比|之前|之后|当晚|联调|边界|检查|清单|代价|取舍/.test(
      text,
    ) ||
    /[A-Za-z]{3,}(?:\(|\.)/.test(text) ||
    /<code|<pre|`[A-Za-z]/.test(text)
  );
}

/** 段落信息密度粗估：过短或过长且无具体信号的段落 */
function estimateLowDensityParagraphs(plainParagraphs: string[]): number {
  let low = 0;
  for (const p of plainParagraphs) {
    if (p.length < 20) continue;
    const hasConcrete = hasConcreteSignal(p);
    const isVague =
      /本质上|认知|体系|赋能|闭环|方法论|重要|关键|真正/.test(p) && !hasConcrete;
    if (isVague || (p.length > 80 && !hasConcrete && /我们|大家|人们/.test(p))) {
      low += 1;
    }
  }
  return low;
}

/** 按 h2 切章粗检：无数字/列表/代码/具名场景 → hollow */
function countHollowSections(contentHtml: string, plain: string): number {
  const chunks = contentHtml
    ? contentHtml.split(/<h2\b[^>]*>/i).slice(1)
    : plain.split(/(?=第[一二三四五六七八九十]|#{1,3}\s)/).filter(Boolean);
  if (chunks.length < 2) {
    // 无明确分章时：全文缺具体信号也算一处 hollow
    return hasConcreteSignal(plain) ? 0 : plain.length > 600 ? 1 : 0;
  }
  let hollow = 0;
  for (const chunk of chunks) {
    const text = stripHtml(chunk);
    if (text.length < 80) continue;
    const hasList = /<(?:ul|ol)\b/i.test(chunk) || /(?:^|\n)\s*[-•\d]+[.)、]/.test(chunk);
    const hasCode = /<(?:pre|code)\b/i.test(chunk);
    const hasScene =
      /某(?:中台|团队|业务|产品|同学)|联调|当晚|报错|对比|代价|取舍|检查表|清单/.test(text);
    if (!hasConcreteSignal(text) && !hasList && !hasCode && !hasScene) {
      hollow += 1;
    }
  }
  return hollow;
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

  const hollowSections = countHollowSections(contentHtml, plain);
  if (hollowSections > 0) {
    issues.push({
      code: "hollow_section",
      message: `约 ${hollowSections} 个章节缺少数字/列表/代码/具名场景，信息密度偏低`,
      severity: hollowSections >= 2 ? "high" : "medium",
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

  // 连续多段长度几乎一样 → 匀速 AI 平铺
  const paraLens = paragraphs.map((p) => p.length).filter((n) => n >= 40);
  if (paraLens.length >= 5) {
    let uniformRuns = 0;
    for (let i = 1; i < paraLens.length; i += 1) {
      const a = paraLens[i - 1];
      const b = paraLens[i];
      if (Math.abs(a - b) <= Math.max(12, a * 0.12)) uniformRuns += 1;
    }
    if (uniformRuns >= 4) {
      issues.push({
        code: "uniform_pace",
        message: "连续多段篇幅过于整齐，缺少长短起伏",
        severity: "medium",
      });
    }
  }

  // 完美三点并列
  const threePoint =
    /首先[\s\S]{0,80}其次[\s\S]{0,80}(?:再者|然后|最后)/.test(plain) ||
    /第一[，,][\s\S]{0,60}第二[，,][\s\S]{0,60}第三/.test(plain) ||
    /一是[\s\S]{0,60}二是[\s\S]{0,60}三是/.test(plain);
  if (threePoint) {
    issues.push({
      code: "three_point_parallel",
      message: "存在「首先/其次/最后」或一二三对称排比，创作度偏低",
      severity: "medium",
    });
  }

  // 缺少可截图转发的短判断句
  const punchlines = paragraphs.filter(
    (p) =>
      p.length >= 12 &&
      p.length <= 42 &&
      /(不是|别再|只会|代价|卡在|不如|真正缺的是|关键在于怎么)/.test(p) &&
      !/首先|其次|综上所述|总而言之|值得注意/.test(p),
  );
  if (plain.length > 800 && punchlines.length === 0) {
    issues.push({
      code: "missing_punchline",
      message: "缺少可转发的短判断句，全文偏匀速正确废话",
      severity: "medium",
    });
  }

  const insightEchoes = countInsightEchoes(plain);
  if (insightEchoes >= 2) {
    issues.push({
      code: "insight_echo",
      message: `核心判断句被复读约 ${insightEchoes} 次，像把同一洞见贴进多章`,
      severity: insightEchoes >= 3 ? "high" : "medium",
    });
  }

  // 开篇前两段同义反复
  const openingParas = plain
    .split(/[。！？]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20)
    .slice(0, 3);
  if (openingParas.length >= 2) {
    const a = openingParas[0].replace(/\s+/g, "");
    const b = openingParas[1].replace(/\s+/g, "");
    let inter = 0;
    const setB = new Set(b);
    for (const ch of new Set(a)) if (setB.has(ch)) inter += 1;
    const union = new Set(a).size + setB.size - inter;
    if (union > 0 && inter / union >= 0.42 && a.length > 30 && b.length > 30) {
      issues.push({
        code: "opening_echo",
        message: "开篇前两句信息高度重叠，像同一意思说了两遍",
        severity: "medium",
      });
    }
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
    factualCodes.has("precise_money") ||
    factualCodes.has("fabricated_metric_claim")
  ) {
    suggestions.push(
      "无出处百分比/「匿名实测」请删除或改成定性（曾出现过、审计会卡住）；技术 P50/吞吐除外",
    );
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
  if (codes.has("low_density") || codes.has("too_short") || codes.has("hollow_section")) {
    suggestions.push("每段保证一个信息增量：读者读完能多会做/多知道一件事；每章补步骤/对比/代码或具名场景");
  }
  if (codes.has("missing_punchline")) {
    suggestions.push("加一句 12–40 字的可转发短判断（代价、边界或「别再…」）");
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
  if (codes.has("repetitive_rhythm") || codes.has("uniform_pace")) {
    suggestions.push("打乱段首句式，长短句交替，避免模板排比与匀速平铺");
  }
  if (codes.has("three_point_parallel")) {
    suggestions.push("三点并列改成 2 点或 5 点，或让第三项打断节奏");
  }
  if (codes.has("insight_echo")) {
    suggestions.push("全文只保留一处核心判断原句；其余章改成检查项、反例或失败路径，勿复读洞见");
  }
  if (codes.has("opening_echo")) {
    suggestions.push("开篇两段合并成一段：先冲突场面，再一句判断，不要同义反复");
  }
  if (codes.has("missing_punchline")) {
    suggestions.push("补一句 20 字左右的锐利判断（代价/反直觉/取舍），方便读者转发");
  }
  if (suggestions.length === 0) {
    suggestions.push("未发现明显低质或事实风险信号；仍建议人工核对案例真实性后再推送");
  }
  return suggestions;
}

export function qualityIssuesToMessages(issues: QualityIssue[]): string[] {
  return issues.map((i) => i.message);
}
