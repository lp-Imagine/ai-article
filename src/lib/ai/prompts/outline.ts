/**
 * 大纲生成 prompt：冲突发现 → 成稿。
 *
 * 版本：v3.1.0
 * - 先挖主题专属张力，再写大纲（避免固定角表套题）
 * - 削弱「交付物 PRD 腔」；章节 summary 用人话写清「读者带走什么」
 * - 冲突阶段输出 atomicInsight + frameworkHint；支持灵感 seedInsight 锁定
 */
import type { ChatMessage } from "@/lib/ai/types";
import {
  buildVoiceIdentityBlocks,
  buildAntiAiVoiceBlock,
  buildDomainAdaptationBlock,
  buildEngineeringOutlineBlock,
  buildOnTopicBlock,
  buildStyleGuide,
  buildWritingUserPayload,
} from "@/lib/ai/prompts/common";

export const OUTLINE_PROMPT_VERSION = "3.1.0";

export type OutlineFrameworkHint =
  | "pain"
  | "story"
  | "list"
  | "compare"
  | "hot-take"
  | "review";

export type OutlineConflict = {
  /** 这篇要钉住的具体张力（必须含主题专有词） */
  tension: string;
  /** 读者卡在哪一步决策/动作 */
  readerMoment: string;
  /** 搞错的可感知代价 */
  stake: string;
  /** 本篇故意不走的套路，一句话 */
  avoidSkeleton: string;
  /** 读者转述给朋友的一句洞见 */
  atomicInsight: string;
  /** 建议写作框架 */
  frameworkHint: OutlineFrameworkHint;
};

export type OutlinePromptInput = {
  topic: string;
  style: string;
  audience: string;
  wordCount: number;
  goal?: string | null;
  keywords?: string | null;
  count: number;
  sectionCount: number;
  engineering: boolean;
  /**
   * @deprecated v3 起优先用 conflict；保留仅为兼容旧调用
   * 非空时表示本次只生成一套方案
   */
  angle: string | null;
  /** 两阶段：单套成稿时锁定的冲突 */
  conflict?: OutlineConflict | null;
  /** 单体模式：多套大纲各自锁定的冲突池 */
  conflicts?: OutlineConflict[] | null;
  /** 软提示（非强制角名），仅作差异化盐粒 */
  seedHint?: string | null;
  /** 灵感点选带入的洞见（冲突阶段锁定锐化） */
  seedInsight?: string | null;
  seedTension?: string | null;
};

export function buildOutlineConflictPrompt(input: {
  topic: string;
  style: string;
  audience: string;
  goal?: string | null;
  keywords?: string | null;
  count: number;
  engineering: boolean;
  seedInsight?: string | null;
  seedTension?: string | null;
}): ChatMessage[] {
  const { topic, count, audience, style } = input;
  const seedInsight = input.seedInsight?.trim() || "";
  const seedTension = input.seedTension?.trim() || "";
  return [
    {
      role: "system",
      content: `你是专栏选题编辑。只做一件事：为同一主题挖出 ${count} 个**互不雷同的真实张力**，供下一步写大纲。本步不写章节目录。

${buildDomainAdaptationBlock()}

${buildVoiceIdentityBlocks({ includeStyleSalt: false })}

${buildOnTopicBlock(input.topic, input.keywords)}

【规则】
- 每个张力必须能回答：谁、卡在什么具体抉择、搞错会付出什么代价
- tension / readerMoment 里必须出现与主题相关的**专有词或具体场景名词**（不要用「隐形需求」「底层逻辑」「方法论」这类万能词）
- ${count} 个张力的论证方向必须不同：例如一个偏时机、一个偏取舍标准、一个偏执行顺序——禁止都落成「先讲翻车再讲正解」
- avoidSkeleton 写清本条故意避开的流水线，例如「不走：翻车现场→诱因→判断标准→行动清单」
- atomicInsight：读者读完转述给朋友的一句判断（≤48 字），禁止「要坚持/很重要」正确废话
- frameworkHint 只能是：pain | story | list | compare | hot-take | review；${count} 条之间框架尽量不全相同
- 禁止虚构姓名、公司、精确百分比；用匿名可核对场景即可
- 目标读者：${audience}；风格：${style}；目标：${input.goal?.trim() || "知识分享"}
${
  seedInsight
    ? `\n【灵感锁定洞见】\n- 用户从灵感选定洞见：${seedInsight}${seedTension ? `\n- 张力提示：${seedTension}` : ""}\n- 第 1 条 conflict 必须围绕该洞见锐化（可改写得更尖，不可换题）；其余 ${Math.max(0, count - 1)} 条另开不同框架/冲突`
    : ""
}

【输出】
JSON：{ "conflicts": [ { "tension", "readerMoment", "stake", "avoidSkeleton", "atomicInsight", "frameworkHint" } ] }
- conflicts 长度必须为 ${count}`,
    },
    {
      role: "user",
      content: JSON.stringify({
        topic,
        keywords: input.keywords,
        audience,
        style,
        goal: input.goal,
        requiredConflictCount: count,
        contentMode: input.engineering ? "engineering-hands-on" : "general",
        ...(seedInsight ? { seedInsight, seedTension: seedTension || null } : {}),
      }),
    },
  ];
}

export function buildOutlinePrompt(input: OutlinePromptInput): ChatMessage[] {
  const {
    topic,
    style,
    audience,
    wordCount,
    count,
    sectionCount,
    engineering,
    angle,
    conflict,
    conflicts,
    seedHint,
  } = input;
  const single = Boolean(conflict) || angle !== null;

  const multiConflictBlock =
    !single && conflicts && conflicts.length > 0
      ? `【冲突池——每个大纲锁定其中一个，不得多套共用同一冲突】
${conflicts
  .map(
    (c, i) =>
      `${i + 1}. 框架：${c.frameworkHint}｜洞见：${c.atomicInsight}｜张力：${c.tension}｜卡点：${c.readerMoment}｜代价：${c.stake}｜避开：${c.avoidSkeleton}`,
  )
  .join("\n")}
- 论证顺序与结尾落点不得同构；禁止整组都写成翻车流水线；framework 尽量不全相同`
      : null;

  const lockBlock = conflict
    ? `【锁定冲突——必须围绕它写，不许换成别的万能角】
- 写作框架：${conflict.frameworkHint}
- 必须兑现的洞见：${conflict.atomicInsight}
- 张力：${conflict.tension}
- 读者卡点：${conflict.readerMoment}
- 搞错代价：${conflict.stake}
- 故意避开：${conflict.avoidSkeleton}
- 标题、章节顺序、结尾落点都必须服务上述张力与洞见；禁止改写成「翻车→诱因→标准→清单」等通用流水线
- atomicInsight 字段原样或仅做锐化，禁止换题`
    : multiConflictBlock
      ? multiConflictBlock
      : angle
        ? `【指定切入（兼容）】${angle}
- 切入必须改变标题、章节顺序与结尾落点，但仍须紧扣主题专有冲突`
        : `- 各方案分别解决不同的读者冲突，论证顺序与结尾落点不得同构`;

  const softSeed =
    seedHint && !conflict
      ? `- 差异化盐粒（参考，非强制模板名）：${seedHint}`
      : "";

  const frameworkContract = conflict
    ? frameworkSummaryHint(conflict.frameworkHint)
    : "按本方案 framework：pain/list→可动手点；hot-take→态度句；compare→取舍边界；story/review→场景转折";

  return [
    {
      role: "system",
      content: `你是公众号与博客专栏主编。${
        single
          ? "生成 1 个可直接进入写作的大纲。"
          : `生成 ${count} 个论证路径真正不同的大纲，不是同一目录换标题。`
      }

${buildDomainAdaptationBlock()}

${buildVoiceIdentityBlocks({ includeStyleSalt: false })}

${buildOnTopicBlock(input.topic, input.keywords)}

${buildAntiAiVoiceBlock()}

${buildEngineeringOutlineBlock(engineering)}

【1. 选题任务】
${lockBlock}
${softSeed}
- 必须服务同一主题「${topic}」，差异在切入与论证路径，不在换赛道
- 目标读者：${audience}，写作风格：${style}，文章目标：${input.goal?.trim() || "知识分享"}，目标字数：约 ${wordCount} 字
- positioning 用 15-30 字人话写清：洞见落点、适合谁、读完带走什么（不要「交付物/锚定」）
- atomicInsight：读者转述给朋友的一句（≤48 字）；有锁定洞见时必须承接
- framework：pain | story | list | compare | hot-take | review（有锁定则沿用）
- readerTension：一句话写清读者卡在哪

${buildStyleGuide(style)}

【2. 章节写法】
- 每个大纲约 ${sectionCount} 章；每章只回答一个别人章回答不了的问题
- heading ≤ 20 字，尽量带主题专有名词；禁止「什么是 / 为什么重要 / 方法论 / 注意事项 / 总结」
- summary 用口语写清「读者读完这章能多知道/多会判断什么」；**禁止**以「给出、通过、拆解、输出、锚定、全面介绍」起句
- 章节合同（按框架）：${frameworkContract}
- ${
        engineering
          ? "工程主题：至少一半章节落到接口、代码、状态、命令或测试边界（写在 summary 里用具体名词，别空喊实战）。"
          : "非工程主题：至少一半章节落到具体场景、反例、对比点或可执行判断（用主题里的词，别用万能职场鸡汤）。"
      }
- 允许不规则：某一章可以是「这篇故意不讲什么」或「我反对的常见建议」，只要服务锁定冲突

【3. 短禁用表】
- 不写百科目录，不写「总结 / 写在最后 / 结语 / 收尾」章（文末总结卡由系统追加）
- 禁止整篇落成：痛点→误解→三步法→注意事项；也禁止：翻车现场→核心诱因→判断标准→行动清单（换词不算）
- 不编造人物、公司、精确数据与对话；不空喊「实战手册」

【输出格式】
${
  single
    ? "- outlines 数组长度必须为 1"
    : `- **必须恰好返回 ${count} 个大纲**（outlines 数组长度 = ${count}）`
}
- JSON：{ "outlines": [ { "title", "positioning", "atomicInsight", "framework", "readerTension", "sections": [ { "heading", "summary" } ] } ] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        ...buildWritingUserPayload({
          topic,
          style,
          wordCount,
          audience,
          goal: input.goal,
          keywords: input.keywords,
          outlineCount: single ? 1 : count,
          sectionsPerOutline: sectionCount,
        }),
        contentMode: engineering ? "engineering-hands-on" : "general",
        mustIncludeCodeInArticle: engineering,
        requiredOutlineCount: single ? 1 : count,
        ...(conflict
          ? { lockedConflict: conflict }
          : conflicts?.length
            ? { lockedConflicts: conflicts }
            : angle
              ? { requiredAngle: angle }
              : {}),
        ...(seedHint && !conflict ? { seedHint } : {}),
      }),
    },
  ];
}

function frameworkSummaryHint(framework: OutlineFrameworkHint): string {
  switch (framework) {
    case "list":
    case "pain":
      return "多数章 summary 须含可动手点/检查项（动词+对象）";
    case "hot-take":
      return "至少一章 summary 含鲜明态度句（我主张/我反对/别再…）";
    case "compare":
      return "至少一章写清取舍边界（什么情况下选 A / 不选 B）";
    case "story":
    case "review":
      return "至少一章用具体场景转折推动洞见，禁止空喊复盘";
    default:
      return "summary 须能看出增强方向";
  }
}
