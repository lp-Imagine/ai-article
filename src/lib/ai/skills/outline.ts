import type { OutlineFramework, OutlineOption } from "@/types/article";
import { OUTLINE_SEED_HINTS } from "@/lib/ai/constants";
import { OUTLINE_PROMPT_VERSION } from "@/lib/ai/prompts/outline";
import type {
  OutlineConflict,
  OutlineFrameworkHint,
} from "@/lib/ai/prompts/outline";
import type { SkillDefinition } from "@/lib/ai/skills/types";

export const OUTLINE_FRAMEWORK_LABELS: Record<OutlineFramework, string> = {
  pain: "痛点",
  story: "故事",
  list: "清单",
  compare: "对比",
  "hot-take": "锐评",
  review: "复盘",
};

const FRAMEWORK_SET = new Set<string>(Object.keys(OUTLINE_FRAMEWORK_LABELS));

export function isOutlineFramework(value: unknown): value is OutlineFramework {
  return typeof value === "string" && FRAMEWORK_SET.has(value);
}

export const OUTLINE_SKILL: SkillDefinition = {
  name: "outline-strategy",
  version: OUTLINE_PROMPT_VERSION,
  description: "先挖主题专属冲突，再生成结构与落点不同的大纲。",
};

/** 主题哈希选盐，避免 index%N 导致第 1 套永远是「翻车角」 */
export function pickOutlineSeedHints(count: number, topic: string): string[] {
  const pool = [...OUTLINE_SEED_HINTS];
  const seed = [...topic].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  // 旋转起点 + 简单洗牌，使同主题多次生成也相对稳定、跨主题分布不同
  const rotated = [...pool.slice(seed % pool.length), ...pool.slice(0, seed % pool.length)];
  for (let i = rotated.length - 1; i > 0; i -= 1) {
    const j = (seed * 31 + i * 17) % (i + 1);
    [rotated[i], rotated[j]] = [rotated[j], rotated[i]];
  }
  const hints: string[] = [];
  for (let i = 0; i < count; i += 1) {
    hints.push(rotated[i % rotated.length]);
  }
  return hints;
}

/** @deprecated 使用 pickOutlineSeedHints；保留兼容 */
export function outlineAngleAt(index: number): string {
  return OUTLINE_SEED_HINTS[index % OUTLINE_SEED_HINTS.length];
}

const PRD_SUMMARY_START =
  /^(给出|通过|拆解|输出|锚定|全面介绍|指出|分别给出)/u;

const GENERIC_HEADING =
  /^(什么是|为什么重要|方法论|注意事项|总结与展望|写在最后|结语|收尾)/u;

const HOLLOW_WORDS_RE =
  /隐形需求|底层逻辑|方法论|赋能|抓手|闭环|认知升级|体系化|正确的废话|要坚持|很重要|持续优化|长期主义/u;

const ENGINEERING_CONCRETE_RE =
  /接口|代码|命令|状态|测试|字段|API|Hook|组件|超时|重试|日志|边界|配置|类型|函数|服务|队列|缓存|部署|报错/iu;

const GENERAL_CONCRETE_RE =
  /场景|反例|对比|取舍|边界|步骤|检查|清单|当晚|会上|联调|读者|客户|团队|代价|如果.+不如|什么情况下/u;

/** 修辞骨架标签：用于抓「换词同构」 */
const SKELETON_TAGS: Array<{ id: string; re: RegExp }> = [
  { id: "crash", re: /翻车|后悔|踩坑|现场|弯路/u },
  { id: "cause", re: /诱因|根因|本质|不是.{0,8}是|错配/u },
  { id: "criteria", re: /判断标准|决策依据|核心判断|选型标准/u },
  { id: "playbook", re: /清单|照做|行动项|步骤清单|避坑指南/u },
  { id: "myth", re: /误解|以为|其实不然|认知纠偏/u },
  { id: "compare", re: /对比|选型|取舍|还是该/u },
  { id: "howto", re: /三步|方法论|闭环|体系化/u },
  { id: "pain-howto", re: /痛点|原则|注意事项|为什么重要/u },
];

export function outlineSkeletonSignature(outline: OutlineOption): string {
  const text = `${outline.title}|${outline.sections
    .map((s) => `${s.heading}|${s.summary}`)
    .join("|")}`;
  return SKELETON_TAGS.filter((tag) => tag.re.test(text))
    .map((tag) => tag.id)
    .join(">");
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
    GENERIC_HEADING.test(section.heading),
  ).length;
  if (generic > 0) issues.push(`存在 ${generic} 个百科模板式章节标题`);

  const signatures = outlines.map(outlineSkeletonSignature);
  const crashPipeline = signatures.filter(
    (s) => s.includes("crash") && s.includes("cause") && (s.includes("criteria") || s.includes("playbook")),
  );
  if (crashPipeline.length >= 2) {
    issues.push("多套大纲同属「翻车→诱因→标准/清单」流水线");
  }
  const sigCounts = new Map<string, number>();
  for (const sig of signatures) {
    if (!sig) continue;
    sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
  }
  for (const [sig, n] of sigCounts) {
    if (n >= 2) issues.push(`多套大纲修辞骨架相同（${sig}）`);
  }

  const prdHits = outlines.flatMap((o) => o.sections).filter((s) => PRD_SUMMARY_START.test(s.summary.trim())).length;
  if (prdHits >= Math.max(3, outlines.length)) {
    issues.push(`存在 ${prdHits} 处 PRD 腔章节摘要（给出/通过/拆解…）`);
  }

  const frameworks = outlines
    .map((o) => o.framework)
    .filter((f): f is OutlineFramework => Boolean(f));
  if (frameworks.length >= 2 && new Set(frameworks).size === 1) {
    issues.push("多套大纲写作框架完全相同");
  }

  const insights = outlines
    .map((o) => (o.atomicInsight ?? "").trim())
    .filter((s) => s.length >= 8);
  if (insights.length >= 2) {
    const normalized = insights.map((s) => s.replace(/\s/g, "").slice(0, 24));
    if (new Set(normalized).size === 1) {
      issues.push("多套大纲洞见几乎相同");
    }
  }

  return {
    score: Math.max(
      0,
      Math.round(
        100 -
          worstSimilarity * 55 -
          generic * 8 -
          crashPipeline.length * 10 -
          Math.max(0, prdHits - 2) * 4 -
          (frameworks.length >= 2 && new Set(frameworks).size === 1 ? 8 : 0),
      ),
    ),
    issues,
  };
}

function topicTokens(topic: string, keywords?: string | null): string[] {
  const raw = `${topic} ${keywords ?? ""}`
    .toLowerCase()
    .split(/[\s,，、/|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  // 中文连续 2–4 字滑窗，抓专有词重叠
  const chars = `${topic}${keywords ?? ""}`.replace(/\s/g, "");
  const windows: string[] = [];
  for (let n = 2; n <= 4; n += 1) {
    for (let i = 0; i + n <= chars.length; i += 1) {
      windows.push(chars.slice(i, i + n));
    }
  }
  return Array.from(new Set([...raw, ...windows])).slice(0, 80);
}

function overlapsTopic(text: string, topic: string, keywords?: string | null): boolean {
  const t = text.toLowerCase();
  return topicTokens(topic, keywords).some((tok) => t.includes(tok.toLowerCase()));
}

function sectionIsConcrete(
  section: { heading: string; summary: string },
  engineering: boolean,
): boolean {
  const text = `${section.heading} ${section.summary}`;
  if (HOLLOW_WORDS_RE.test(text) && text.length < 36) return false;
  return engineering
    ? ENGINEERING_CONCRETE_RE.test(text)
    : GENERAL_CONCRETE_RE.test(text) || ENGINEERING_CONCRETE_RE.test(text);
}

function frameworkContractOk(
  framework: OutlineFramework | undefined,
  sections: OutlineOption["sections"],
): boolean {
  if (!framework || sections.length === 0) return true;
  const blob = sections.map((s) => s.summary).join("｜");
  switch (framework) {
    case "list":
    case "pain":
      return /检查|步骤|清单|边界|先|再|对照|动手|可执行/.test(blob);
    case "hot-take":
      return /主张|反对|别再|不是|而是|代价|我/.test(blob);
    case "compare":
      return /对比|取舍|还是|什么情况下|选|不选|边界/.test(blob);
    case "story":
    case "review":
      return /场景|当晚|当时|后来|转折|复盘|分叉/.test(blob);
    default:
      return true;
  }
}

/** 单套大纲质检：不过关应重抽 */
export function assessSingleOutlineQuality(
  outline: OutlineOption,
  opts?: { engineering?: boolean; topic?: string; strictSeed?: boolean },
): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const sections = outline.sections ?? [];
  const engineering = opts?.engineering ?? false;
  if (sections.length === 0) issues.push("无章节");

  const genericHeadings = sections.filter((s) => GENERIC_HEADING.test(s.heading)).length;
  if (genericHeadings > 0) issues.push("含百科模板标题");

  const prd = sections.filter((s) => PRD_SUMMARY_START.test((s.summary ?? "").trim())).length;
  if (prd >= Math.ceil(sections.length / 2)) issues.push("过半章节 summary 为 PRD 腔起句");

  const title = outline.title ?? "";
  if (/实战手册|全面解析|深度剖析/.test(title)) {
    issues.push("标题套话过重");
  }

  const insight = (outline.atomicInsight ?? "").trim();
  if (!insight || insight.length < 8) {
    issues.push("缺少可转述洞见");
  } else if (HOLLOW_WORDS_RE.test(insight)) {
    issues.push("洞见为空洞正确废话");
  }

  const concreteNeed = Math.max(1, Math.ceil(sections.length / 2));
  const concreteCount = sections.filter((s) => sectionIsConcrete(s, engineering)).length;
  if (sections.length > 0 && concreteCount < concreteNeed) {
    issues.push(`具体章节不足（${concreteCount}/${concreteNeed}）`);
  }

  if (!frameworkContractOk(outline.framework, sections)) {
    issues.push("章节 summary 未兑现写作框架合同");
  }

  if (opts?.strictSeed && sections.length > 0) {
    // 无锁定冲突、仅靠盐粒时更严：任一无具体摘要即拒
    if (concreteCount < sections.length) {
      issues.push("无冲突锁定时要求全部章节可落地");
    }
  }

  return { ok: issues.length === 0, issues };
}

export function isValidOutlineConflict(value: unknown): value is OutlineConflict {
  return normalizeOutlineConflict(value) !== null;
}

export type NormalizeConflictOpts = {
  topic?: string;
  keywords?: string | null;
};

/**
 * 冲突归一化：核心四字段 + 洞见/框架硬要求；
 * 万能词、与主题无重叠、框架非法 → 拒收（触发重抽）
 */
export function normalizeOutlineConflict(
  value: unknown,
  opts?: NormalizeConflictOpts,
): OutlineConflict | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const tension = typeof c.tension === "string" ? c.tension.trim() : "";
  const readerMoment =
    typeof c.readerMoment === "string" ? c.readerMoment.trim() : "";
  const stake = typeof c.stake === "string" ? c.stake.trim() : "";
  const avoidSkeleton =
    typeof c.avoidSkeleton === "string" ? c.avoidSkeleton.trim() : "";
  if (
    tension.length < 8 ||
    readerMoment.length < 4 ||
    stake.length < 4 ||
    avoidSkeleton.length < 4
  ) {
    return null;
  }

  if (HOLLOW_WORDS_RE.test(`${tension}${readerMoment}${stake}`)) {
    return null;
  }

  const topic = opts?.topic?.trim() ?? "";
  if (topic) {
    const hit =
      overlapsTopic(tension, topic, opts?.keywords) ||
      overlapsTopic(readerMoment, topic, opts?.keywords);
    if (!hit) return null;
  }

  const rawInsight =
    typeof c.atomicInsight === "string" ? c.atomicInsight.trim() : "";
  if (rawInsight.length < 8 || HOLLOW_WORDS_RE.test(rawInsight)) {
    return null;
  }
  const atomicInsight = rawInsight.slice(0, 72);

  const rawFramework =
    typeof c.frameworkHint === "string" ? c.frameworkHint.trim() : "";
  if (!isOutlineFramework(rawFramework)) {
    return null;
  }

  return {
    tension,
    readerMoment,
    stake,
    avoidSkeleton,
    atomicInsight,
    frameworkHint: rawFramework,
  };
}

/** 多样性问题是否应硬丢弃靠后的同构方案 */
export function isHardDiversityIssue(issue: string): boolean {
  return /流水线|修辞骨架相同|标题与章节骨架过于相似|写作框架完全相同|洞见几乎相同/.test(
    issue,
  );
}
