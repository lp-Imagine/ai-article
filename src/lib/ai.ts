import type { OutlineOption } from "@/types/article";
import { getEnvValue } from "@/lib/config-bridge";
import { highlightCodeBlocks } from "@/lib/code-highlight";
import { normalizeCalloutBlocks } from "@/lib/wechat-style";

type TextRole = "outline" | "content" | "summary" | "titles" | "cover-prompt" | "polish" | "expand" | "section-image";

const PRIMARY_TEXT_ROLES = new Set<TextRole>(["outline", "content", "polish", "expand"]);

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function readConfig(key: string, fallback: string): string {
  const value = getEnvValue(key) ?? process.env[key];
  return value && value.trim() ? value : fallback;
}

function isAiConfigured() {
  return Boolean(getEnvValue("AI_API_KEY") || process.env.AI_API_KEY);
}

function resolveModelForRole(role: TextRole): string {
  const primaryModel = readConfig("TEXT_MODEL_NAME", "gpt-4o-mini");
  if (PRIMARY_TEXT_ROLES.has(role)) return primaryModel;

  const auxiliaryModel = readConfig("AUXILIARY_TEXT_MODEL_NAME", "");
  return auxiliaryModel || primaryModel;
}

/** 按任务类型解析模型名、Base URL、API Key（辅助任务可独立配置厂商） */
export function getLLMCredentialsForRole(role: TextRole = "content") {
  const primaryBaseUrl = readConfig("AI_BASE_URL", "https://api.openai.com/v1");
  const primaryApiKey = readConfig("AI_API_KEY", "");
  const primaryModel = readConfig("TEXT_MODEL_NAME", "gpt-4o-mini");

  if (PRIMARY_TEXT_ROLES.has(role)) {
    return {
      model: primaryModel,
      baseUrl: primaryBaseUrl,
      apiKey: primaryApiKey,
    };
  }

  const auxiliaryModel = readConfig("AUXILIARY_TEXT_MODEL_NAME", "");
  const auxiliaryBaseUrl = readConfig("AUXILIARY_AI_BASE_URL", "");
  const auxiliaryApiKey = readConfig("AUXILIARY_AI_API_KEY", "");

  return {
    model: auxiliaryModel || primaryModel,
    baseUrl: auxiliaryBaseUrl || primaryBaseUrl,
    apiKey: auxiliaryApiKey || primaryApiKey,
  };
}

/** 运行时读取 LLM 配置（非模块常量，确保每次都读最新值） */
function getLLMConfig(role: TextRole = "content") {
  const { model, baseUrl, apiKey } = getLLMCredentialsForRole(role);
  return { model, baseUrl, apiKey };
}

async function callChat(
  messages: ChatMessage[],
  opts?: { jsonMode?: boolean; maxTokens?: number; role?: TextRole },
) {
  const jsonMode = opts?.jsonMode ?? true;
  const maxTokens = opts?.maxTokens ?? 2048;
  const role = opts?.role ?? "content";

  const { model, baseUrl, apiKey } = getLLMConfig(role);
  if (!apiKey) {
    return null;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
      response_format: jsonMode ? { type: "json_object" } : undefined,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LLM request failed: ${res.status} ${errBody.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };

  return json.choices[0]?.message?.content ?? "";
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type WritingParams = {
  topic: string;
  style?: string | null;
  audience?: string | null;
  goal?: string | null;
  keywords?: string | null;
  wordCount?: number | null;
};

function getAccountPersona(): string {
  return getEnvValue("ACCOUNT_PERSONA")?.trim() ?? "";
}

function parseKeywords(keywords?: string | null): string[] {
  if (!keywords?.trim()) return [];
  return keywords
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildAccountPersonaBlock(): string {
  const persona = getAccountPersona();
  if (!persona) return "";

  return (
    `【账号背景（软约束，不覆盖主题领域）】\n` +
    `${persona}\n` +
    `- 以上只影响叙述口吻、举例偏好和读者关系；**文章写什么仍完全由「主题」决定**\n` +
    `- 若主题与账号主领域不同（如账号偏技术、主题是育儿/理财），按主题领域写，不要硬扯技术\n` +
    `- 若主题与账号领域一致，可自然带入实践细节（代码、工程、Agent 等），但仍需服务主题本身`
  );
}

function buildDomainAdaptationBlock(): string {
  return (
    `【领域适配（通用，跨行业）】\n` +
    `- **主题决定领域**：写什么由用户输入的主题/关键词决定，不要默认所有文章都是技术文或职场文\n` +
    `- 技术/编程类：可用代码示例、架构拆解、工程踩坑；术语用 <code> 标注\n` +
    `- 产品/商业/成长/生活类：用场景、决策过程、具体数字或现象；少堆代码，多讲「为什么这样选」\n` +
    `- 同一套写作标准适用所有领域：具体、可信、有层次、不夸夸其谈\n` +
    `- 判断领域时看主题语义，不看账号名称`
  );
}

function buildStyleGuide(style: string): string {
  switch (style) {
    case "观点型":
      return (
        `【风格：观点型】\n` +
        `- 开篇亮明核心判断，全文围绕一条主线论证\n` +
        `- 案例和数据服务于论点，不做教程式步骤罗列\n` +
        `- 允许有态度，但每个判断都要有依据`
      );
    case "故事型":
      return (
        `【风格：故事型】\n` +
        `- 用具体经历串联信息，场景描写优先于概念定义\n` +
        `- 道理从故事里自然浮现，避免教科书式「首先/其次/最后」\n` +
        `- 仍要给出读者可带走的一个结论或小行动`
      );
    default:
      return (
        `【风格：干货型】\n` +
        `- 结构清晰，读者扫读即可抓到方法\n` +
        `- 步骤、清单、对比优先；理论点到为止\n` +
        `- 每个建议尽量可执行、可验证`
      );
  }
}

function buildWritingUserPayload(input: WritingParams & { outline?: unknown; outlineCount?: number; sectionsPerOutline?: number }) {
  const style = input.style || "干货型";
  return {
    topic: input.topic,
    style,
    audience: input.audience?.trim() || "公众号读者",
    goal: input.goal?.trim() || "知识分享",
    keywords: parseKeywords(input.keywords),
    wordCount: input.wordCount ?? 1200,
    ...(input.outline !== undefined ? { outline: input.outline } : {}),
    ...(input.outlineCount !== undefined ? { outlineCount: input.outlineCount } : {}),
    ...(input.sectionsPerOutline !== undefined ? { sectionsPerOutline: input.sectionsPerOutline } : {}),
  };
}

/** 正文生成 / 润色共用的微信 HTML 格式规范（违反会导致推送排版错乱） */
const ARTICLE_HTML_FORMAT_RULES = `
【微信 HTML 格式（硬性）】
文章推送微信公众号，只允许下列结构；禁止 Markdown、inline style、自创 class、figure/img/section/table。

- 正文步骤：<ol><li><strong>标题</strong>说明</li></ol>
- 并列要点：<ul><li><strong>标题</strong>说明</li></ul>
- mp-tip：div 内只能有单个 <ol>，li 结构与正文 ol 完全相同；禁止 ul、多个 p、嵌套 li、写「实用技巧」等标题
- mp-warning：div 内只用 <p>...</p>；禁止列表和「注意」标题
- 总结：<h2>总结</h2> + <div class="mp-summary"><p>...</p></div>
- 引用：<blockquote><p>...</p></blockquote>

列表项统一写法：<li><strong>2-8字标题</strong>说明正文</li>（标题与说明同一行，不用 br，li 内不用 p）
`.trim();

/** 润色 / 扩写用的精简版，避免占用过多上下文 */
const ARTICLE_HTML_FORMAT_RULES_BRIEF = `
【HTML 格式】保留现有结构；mp-tip 内仅单个 <ol>；mp-warning/mp-summary 内仅 <p>；列表项用 <li><strong>标题</strong>说明</li>；禁止新增 figure/img/section/table/自创 class。
`.trim();

function computeContentMaxTokens(wordCount: number): number {
  // 中文 + HTML + JSON 包装，约 2 token/字，留生成余量
  return Math.min(8192, Math.max(4096, Math.ceil(wordCount * 2.2)));
}

function countPlainTextChars(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
}

/**
 * 后处理：检测正文中未被 <pre><code> 包裹的代码块，自动修复。
 * LLM 有时会把代码直接塞在 <p> 标签里，这个函数负责兜底。
 */
function fixCodeBlocks(html: string): string {
  // 代码特征：连续 3 行以上以 import/from/def/class/try/with/for/while/if 等关键字开头
  const codeLinePattern =
    /^\s*(import\s+|from\s+\S+\s+import\s+|def\s+\w+\s*\(|class\s+\w+|try\s*:|except\s|with\s+\S+\s+as\s|for\s+\w+\s+in\s|while\s+\S|if\s+__name__|elif\s|\belse\s*:|\breturn\s|@\w+)/m;

  // 匹配 <p>...</p> 中混入多行代码的情况
  // 特征：<p> 内容包含换行且有多行匹配代码特征
  return html.replace(
    /<p([^>]*)>([\s\S]*?)<\/p>/gi,
    (_full, attrs: string, inner: string) => {
      // 如果内容里已经有 <pre> 或 <code>，跳过
      if (/<pre|<code/i.test(inner)) return _full;

      const lines = inner.split(/\n/);
      const codeLines = lines.filter((l) => codeLinePattern.test(l));

      // 至少 3 行代码特征才认为是代码块
      if (codeLines.length < 3) return _full;

      // 找到代码块的起止行
      let firstCode = -1;
      let lastCode = -1;
      for (let i = 0; i < lines.length; i++) {
        if (codeLinePattern.test(lines[i])) {
          if (firstCode === -1) firstCode = i;
          lastCode = i;
        }
      }

      // 扩展范围：包含代码前后的空行或短行
      const start = Math.max(0, firstCode - 1);
      const end = Math.min(lines.length, lastCode + 2);

      const before = lines.slice(0, start).join("\n").trim();
      const code = lines.slice(start, end).join("\n").trim();
      const after = lines.slice(end).join("\n").trim();

      const parts: string[] = [];
      if (before) parts.push(`<p${attrs}>${before}</p>`);
      parts.push(`<pre><code>${code}</code></pre>`);
      if (after) {
        // after 部分如果也像代码，继续递归处理
        const afterFixed = fixCodeBlocks(`<p${attrs}>${after}</p>`);
        parts.push(afterFixed);
      }

      return parts.join("\n<hr />\n");
    },
  );
}

/** 去掉完全重复的段落/卡片（保守：仅精确匹配） */
function dedupeRepeatedBlocks(html: string): string {
  const seen = new Set<string>();

  function normalize(inner: string): string {
    return inner
      .replace(/<[^>]+>/g, "")
      .replace(/[\u00A0\s]+/g, "")
      .trim();
  }

  let result = html;
  result = result.replace(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi, (full, inner: string) => {
    const key = normalize(inner);
    if (key.length < 24) return full;
    if (seen.has(key)) return "";
    seen.add(key);
    return full;
  });

  for (const cls of ["mp-tip", "mp-warning", "mp-summary"]) {
    const blockSeen = new Set<string>();
    const re = new RegExp(`<div class="${cls}">([\\s\\S]*?)<\\/div>`, "gi");
    result = result.replace(re, (full, inner: string) => {
      const key = normalize(inner);
      if (key.length < 24) return full;
      if (blockSeen.has(key)) return "";
      blockSeen.add(key);
      return full;
    });
  }

  return result.replace(/\n{3,}/g, "\n\n");
}

function buildSections(topic: string, sectionCount: number = 3, variant: number = 0): { heading: string; summary: string }[] {
  const templates = [
    // 变体 0：认知-误区-行动
    [
      { heading: `为什么${topic}现在才被重视`, summary: "从行业变化、读者认知升级、技术成熟度三个维度切入。" },
      { heading: `${topic}最常见的三个误解`, summary: "用真实踩坑经历拆解误区，让读者有代入感。" },
      { heading: `一个可复制的${topic}实践框架`, summary: "分步骤给出具体执行方案，附可检查的完成标准。" },
      { heading: `${topic}的进阶技巧`, summary: "基础跑通后的提效要点和常见瓶颈突破。" },
      { heading: `值得关注的趋势与长期思路`, summary: "未来半年到一年的判断，给读者一个持续关注的视角。" },
    ],
    // 变体 1：故事-洞察-清单
    [
      { heading: `一个让我对${topic}彻底改观的瞬间`, summary: "用具体故事引入，建立情感共鸣，让读者愿意继续读。" },
      { heading: `${topic}的本质是什么`, summary: "抛开表面技巧，回到底层原理，帮读者建立正确认知框架。" },
      { heading: `上手${topic}的最小可行清单`, summary: "去除所有非必要步骤，只保留马上能执行的 3-5 个核心动作。" },
      { heading: `为什么很多人做不好${topic}`, summary: "分析失败案例的共性原因，给出避坑指南。" },
      { heading: `我的日常实践与迭代心得`, summary: "分享持续优化过程中的真实感受和经验教训。" },
    ],
    // 变体 2：反常识-对比-方法论
    [
      { heading: `关于${topic}，你可能一直被误导了`, summary: "用数据或反直觉观点挑战常规认知，制造阅读动机。" },
      { heading: `${topic}的旧方法 vs 新思路`, summary: "对比两种路径的差异，突出新思路的优势。" },
      { heading: `一套经过验证的${topic}实战方法论`, summary: "给出完整的方法框架，每一步都有明确的判断标准。" },
      { heading: `真实场景：我用${topic}解决的实际问题`, summary: "还原一个具体场景，展示从问题到解决方案的完整过程。" },
      { heading: `长期坚持${topic}的复利效应`, summary: "跳出一时效果，谈长期积累带来的质变。" },
    ],
    // 变体 3：问题驱动-拆解-工具
    [
      { heading: `当你遇到${topic}问题时，第一反应是什么`, summary: "用常见场景引发读者自我对照，建立「这篇文章是写给我的」的感受。" },
      { heading: `拆解${topic}：从困惑到清晰只需这三步`, summary: "把复杂问题拆成可理解、可操作的三个层次。" },
      { heading: `${topic}的实用工具与资源推荐`, summary: "列出具体工具、参考资源和使用建议，增加文章收藏价值。" },
      { heading: `不同阶段${topic}的侧重点`, summary: "按入门、进阶、精通三个阶段分别给出建议。" },
      { heading: `避免${topic}中最大的浪费`, summary: "指出最容易被忽视的效率杀手，给出预防方案。" },
    ],
  ];

  const selected = templates[variant % templates.length];
  return selected.slice(0, Math.min(sectionCount, selected.length));
}

export async function generateOutline(input: {
  topic: string;
  style?: string | null;
  wordCount?: number | null;
  audience?: string | null;
  goal?: string | null;
  keywords?: string | null;
  outlineCount?: number | null;
}): Promise<OutlineOption[]> {
  const style = input.style || "干货型";
  const audience = input.audience || "公众号读者";
  const wordCount = input.wordCount || 1200;
  const count = Math.min(6, Math.max(2, input.outlineCount ?? 3));

  // 根据字数决定每个大纲的章节数
  const sectionCount =
    wordCount <= 1200 ? 3 :
    wordCount <= 2000 ? 4 :
    wordCount <= 3000 ? 5 :
    6;

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是一位资深公众号主编，擅长策划高打开率和高完读率的文章。请基于用户输入，生成 ${count} 个互不相同的大纲方案。

${buildDomainAdaptationBlock()}

${buildAccountPersonaBlock()}

【核心要求】
- 每个大纲必须有鲜明差异：不同的切入角度、不同的叙事节奏、不同的说服策略
- 方案之间要有「选 A 还是选 B」的张力，而不是同一个骨架换了几个词
- 目标读者：${audience}，写作风格：${style}，文章目标：${input.goal?.trim() || "知识分享"}，目标字数：${wordCount} 字
- 大纲面向真实可信的内容，不做夸大承诺，不用绝对化表述

${buildStyleGuide(style)}

【标题要求】
- 每个大纲 title 简洁有力，含核心关键词，不超过 20 字
- 用具体信息或真实疑问吸引点击，禁止标题党、震惊体、虚假承诺
- 每个 title 来自不同范式，禁止重复使用同一范式：
1. 悬念/提问型——如「为什么你做不好XXX」「XXX的真正瓶颈是什么」
2. 数字清单型——如「XXX的 3 个反直觉真相」「5 个让你效率翻倍的XXX技巧」
3. 对比/反差型——如「会XXX的人 vs 不会XXX的人，差距在哪里」
4. 场景代入型——如「如果你也在为XXX焦虑，这篇文章是写给你的」
5. 方法论/指南型——如「XXX实战手册：从入门到精通」「一份可复制的XXX行动方案」
6. 观点/态度型——如「我用了 3 年才明白：XXX根本不是你想的那样」
标题语言要自然、有呼吸感，避免「：」冒号模板句式堆砌。

【章节要求】
- 每个大纲的章节标题避免教科书式（「什么是XXX」「XXX的重要性」）
- 优先：设问句、动作引导、具体场景、反常识判断
- 章节之间逻辑递进，**各章 summary 不得重叠**——每章只负责一个独立子问题，不写「换个说法的同一观点」
- sections 每项 summary 用一句话说明「本章新增什么信息」，禁止写「全面介绍XXX」

【输出格式】
JSON 数组，每个元素包含：
- title: 文章标题（简洁有力，含核心关键词，不超过 20 字）
- positioning: 一句话说明这个方案的定位和适合什么类型的读者（15-30 字）
- sections: 章节数组，每项 { heading: string, summary: string }
输出 { "outlines": [...] }`,
    },
    {
      role: "user",
      content: JSON.stringify(
        buildWritingUserPayload({
          topic: input.topic,
          style,
          wordCount,
          audience,
          goal: input.goal,
          keywords: input.keywords,
          outlineCount: count,
          sectionsPerOutline: sectionCount,
        }),
      ),
    },
  ];

  const raw = await callChat(prompt, { jsonMode: true, maxTokens: 2048, role: "outline" });
  const parsed = safeParse<{ outlines?: OutlineOption[] }>(raw, {});

  if (parsed.outlines && parsed.outlines.length > 0) {
    return parsed.outlines.slice(0, count).map((opt, idx) => ({
      index: idx,
      title: opt.title ?? `${input.topic}：方案 ${idx + 1}`,
      positioning: opt.positioning ?? `${style}向，约 ${wordCount} 字。`,
      sections: (opt.sections ?? []).map((s) => ({
        heading: s.heading ?? "未命名章节",
        summary: s.summary ?? "",
      })),
    }));
  }

  return buildFallbackOutlines(input.topic, style, audience, wordCount, count);
}

function buildFallbackOutlines(
  topic: string,
  style: string,
  audience: string,
  wordCount: number,
  count: number = 3,
): OutlineOption[] {
  const sectionCount =
    wordCount <= 1200 ? 3 :
    wordCount <= 2000 ? 4 :
    wordCount <= 3000 ? 5 :
    6;

  const allOptions: OutlineOption[] = [
    {
      index: 0,
      title: `为什么你做不好${topic}？问题不在能力，在这三点`,
      positioning: `适合${audience}的${style}内容，约 ${wordCount} 字。`,
      sections: buildSections(topic, sectionCount, 0),
    },
    {
      index: 1,
      title: `${topic}实战手册：3 个步骤让你少走两年弯路`,
      positioning: `更偏方法清单与执行建议。`,
      sections: buildSections(topic, sectionCount, 1),
    },
    {
      index: 2,
      title: `关于${topic}，我踩过的坑比你看过的文章还多`,
      positioning: `以真实经历串联，适合提高可读性与个人风格辨识度。`,
      sections: buildSections(topic, sectionCount, 2),
    },
    {
      index: 3,
      title: `${topic}的 4 个反直觉真相（大部分人都搞反了）`,
      positioning: `反常识视角，适合建立"被戳中"的内容感。`,
      sections: buildSections(topic, sectionCount, 3),
    },
    {
      index: 4,
      title: `如果你也厌倦了${topic}的泛泛而谈，试试这个方法`,
      positioning: `场景代入型，用具体问题开篇，一步步给出答案。`,
      sections: buildSections(topic, sectionCount, 0),
    },
    {
      index: 5,
      title: `深度长文｜我承认，以前对${topic}的理解太浅了`,
      positioning: `深度长文型（约 ${wordCount} 字），适合建立专业人设。`,
      sections: buildSections(topic, sectionCount, 1),
    },
  ];

  return allOptions.slice(0, count).map((opt, idx) => ({ ...opt, index: idx }));
}

function padText(text: string, targetLength: number, sectionTitle: string): string {
  if (text.length >= targetLength) return text;
  const blocks = [
    `这里需要更多具体细节。你可以想象读者是一位 ${sectionTitle} 方向的新手，先告诉他常见的认知误区。`,
    `举一个真实场景：如果今天就要动手做 ${sectionTitle}，第一步会卡在哪里。把这一步拆细，再给一个最低成本的解决方案。`,
    `再补一段经验：很多人在 ${sectionTitle} 上半途而废，并不是因为方法不对，而是缺少一个可持续的反馈机制。`,
    `给一个可以立刻执行的小练习：例如用 15 分钟尝试一种新做法，并把结果记下来，下周对比。`,
    `总结一下本小节的核心动作：识别问题 → 拆解步骤 → 设定反馈 → 持续优化。`,
    `如果你愿意，可以把你现在的真实做法告诉我，我会根据你的实际情况再帮你优化一版。`,
  ];
  let extended = text;
  while (extended.length < targetLength) {
    extended += "\n\n" + blocks[extended.length % blocks.length];
  }
  return extended;
}

export async function generateContent(input: {
  topic: string;
  outline?: OutlineOption | null;
  style?: string | null;
  wordCount?: number | null;
  audience?: string | null;
  goal?: string | null;
  keywords?: string | null;
}) {
  const style = input.style || "干货型";
  const wordCount = input.wordCount ?? 1200;
  const sections = input.outline?.sections ?? buildSections(input.topic);
  const perSection = Math.max(280, Math.floor(wordCount / Math.max(sections.length, 1)));
  const accountBlock = buildAccountPersonaBlock();
  const domainBlock = buildDomainAdaptationBlock();
  const styleGuide = buildStyleGuide(style);

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是一位写了 8 年公众号的资深主笔，读者评价你的文章「像朋友在聊天但每句都有信息量」。请严格基于给定大纲写一篇文章——大纲里的每个章节只写一次，不要另起炉灶重复展开同一主题。

${domainBlock}

${accountBlock}

${styleGuide}

${ARTICLE_HTML_FORMAT_RULES}

【标题要求】
- title 简洁有力，包含 1-2 个核心关键词，不超过 20 字
- 用具体信息或真实疑问吸引点击，不用夸张承诺、不用「震惊」「必看」「颠覆」
- 禁止「：」冒号模板句（如「XXX：从入门到精通」）

【写作人格】
- 第一人称「我」，像朋友分享，结合读者真实场景引发共鸣
- 观点要有依据（经历、现象、对比），没有依据时不硬编，用「我观察到」「常见情况是」留余地
- 不做无来源断言，不用绝对化语气

【开头要求】
- 禁止「在当今时代」「随着XX发展」「近年来」等模板开头
- 用具体场景、可核实现象或直击痛点的问题开篇，2-3 句、一屏读完
- 开头只负责「代入」，不要把后文各章节内容提前讲一遍

【逻辑结构】
- 章节用 <h2>，章节之间用 <hr /> 隔开；**全文最多 2 个 <h3>**，仅在大章节内确实需要分层时使用
- 每个 <h2> 章节只推进**一个**新论点，写透即收，不重复前面章节已说的结论
- 每段只表达一层意思，段首点题即可；段间用一句过渡衔接，禁止段段都用「但真正的问题是…」套话
- 步骤类内容用 <ol>，并列要点用 <ul>，列表项之间不得语义重复
- 列表项写法见上方「微信排版格式规范」：<li><strong>标题</strong>说明正文</li>（同一行紧接，不要 <br>）
- **严禁**嵌套 li、li 内套 ul/ol、li 内包 <p>（详见格式规范）

【HTML 白名单（只能用这些，禁止自创格式）】
- 允许：\`<p>\` \`<h2>\` \`<h3>\` \`<hr />\` \`<strong>\` \`<code>\` \`<pre><code>\` \`<blockquote>\` \`<ul><li>\` \`<ol><li>\` \`<div class="mp-tip">\` \`<div class="mp-warning">\` \`<div class="mp-summary">\`
- **禁止**：\`<figure>\` \`<img>\` \`<figcaption>\` — 配图由系统「章节配图」自动插入，正文不要写图片
- **禁止**：\`<section>\` \`<span style>\` \`<table>\` \`<div>\`（mp-* 除外）及 Markdown 语法
- 全文组件用量：mp-tip ≤ 2、mp-warning ≤ 2、blockquote ≤ 2；不要每章都堆卡片和列表，以 \`<p>\` 叙述为主

【内容层次（全文交替，非每章堆砌）】
- 案例、数据、正反面观点在**全文**自然分布即可，不要求每个章节都凑齐「道理+案例+数据+反面」
- 同一案例或同一判断全文最多出现 1 次；后文引用时用「前面提到的…」一句带过，禁止整段重写
- 需要深度时解释「为什么」，但不要用不同措辞把同一结论说三遍
- 专业概念首次出现时用生活化语言或 <code> 简短解释

【段落节奏与轻重点】
- 长句与短句交替，每段不超过 4 句
- **重点标注（硬性）**：必须用 HTML \`<strong>\` 标注，禁止 Markdown \`**\` 或纯文本假加粗
- 每个 \`<p>\` 段落至少 1 处 \`<strong>\`，标注该段核心判断、关键术语或转折结论（2-10 字短语）
- 全文平均每 150-200 字至少 1 处 \`<strong>\`，让读者扫读时能抓住重点
- 列表项标题仍用 \`<li><strong>标题</strong>说明正文</li>\` 结构
- blockquote / mp-tip / mp-warning 全篇各最多 2 次，且必须承载**正文未展开的新信息**，不得把正文原话换个盒子再贴一遍

【结构组件】
- <blockquote>：非常规但值得单独品味的判断，用 \`<blockquote><p>...</p></blockquote>\`
- <div class="mp-tip"> / <div class="mp-warning"> / <div class="mp-summary">：结构严格遵循上方「微信排版格式规范」，禁止自创变体

【反重复（硬性）】
- 禁止用同义词改写重复同一观点（如先说「顺序错了」，后又说「关键在于先后」）
- 禁止开头、正文、总结三处讲同一个故事或同一个例子
- 禁止每个章节结尾都写「所以最重要的是…」式收束
- 若某观点已在 tip/warning/blockquote 里完整表达，正文不要再展开一遍
- 写完后通读：删除**完全重复**的段落即可，不要为压缩篇幅而省略大纲章节应有的论据和案例

【质量标准】
- 信息密度：每段都有新信息，避免同义反复，但**章节该展开的要写够**
- 逻辑连贯：论点→论据→结论，前后不矛盾
- 真实可信：案例具体，数据谨慎，不虚构权威
- 读者价值：读完有方法、框架或新视角
- 可读性：小标题清晰，重点突出

【严禁与慎用】
- 严禁：夸夸其谈、空洞鸡汤、夸大承诺、无依据断言、「一定要」「必须」「绝对」「100%」
- 严禁：赋能、抓手、闭环、底层逻辑、降维打击、颗粒度、对齐、倒逼、深挖
- 严禁：结尾引导关注、点赞、转发

【代码与术语格式】
- 文中出现的函数名、变量名、类名、命令行、API 名称等专业术语，用 <code> 包裹
- 多行代码示例（3 行以上），必须用 <pre><code>...</code></pre> 包裹，内部保持原始缩进和换行
- 代码块前后必须用 <hr /> 与正文明确分隔
- 示例格式：
  <p>下面是完整的读取逻辑：</p>
  <hr />
  <pre><code>import csv
  from pathlib import Path

  rows = []
  with open("data.csv") as f:
      reader = csv.DictReader(f)
      for row in reader:
          rows.append(row)
  </code></pre>
  <hr />

【输出格式】
JSON：{ "title": string, "summary": string, "content": string }
- title：简洁有力，含核心关键词，不超过 20 字
- summary：80-120 字，概括读者收获，不重复正文句子
- content：完整 HTML（不含 <article>、<h1>，不含签名和关注引导）
- 目标篇幅 **${wordCount} 字**（纯文本，去掉 HTML 标签后统计），允许上下浮动 10%，**不得低于 ${Math.floor(wordCount * 0.85)} 字**
- 每个 <h2> 章节建议 ${perSection} 字左右，用 <p> 叙述展开，不要把整章压缩成短列表了事
- 避免重复注水，但**必须写够目标字数**；各章节围绕大纲 summary 充分展开，不复述其他章节结论`,
    },
    {
      role: "user",
      content: JSON.stringify({
        ...buildWritingUserPayload({
          topic: input.topic,
          style,
          wordCount,
          audience: input.audience,
          goal: input.goal,
          keywords: input.keywords,
          outline: input.outline,
        }),
        writingRequirements: {
          targetWordCount: wordCount,
          minimumWordCount: Math.floor(wordCount * 0.85),
          suggestedWordsPerSection: perSection,
          sectionCount: sections.length,
        },
      }),
    },
  ];

  const maxTokens = computeContentMaxTokens(wordCount);
  const raw = await callChat(prompt, { jsonMode: true, maxTokens, role: "content" });
  const parsed = safeParse<{ title?: string; summary?: string; content?: string }>(
    raw,
    {},
  );

  if (parsed.content && parsed.content.length > 600) {
    // 安全清理：去掉任何 LLM 可能误生成的 h1 和 mp-signature
    const safeContent = parsed.content
      .replace(/<h1[^>]*>[\s\S]*?<\/h1>/g, "")
      .replace(/<div class="mp-signature">[\s\S]*?<\/div>/g, "");
    const fixedContent = dedupeRepeatedBlocks(fixCodeBlocks(normalizeCalloutBlocks(safeContent)));
    const plainChars = countPlainTextChars(fixedContent);
    const minWords = Math.floor(wordCount * 0.85);
    if (plainChars < minWords) {
      console.warn(
        `[generateContent] 正文字数 ${plainChars} 低于目标 ${wordCount}（下限 ${minWords}），maxTokens=${maxTokens}`,
      );
    }
    // 对代码块进行语法高亮（内联样式，兼容微信公众号）
    const highlightedContent = highlightCodeBlocks(fixedContent);
    return {
      title: parsed.title ?? input.outline?.title ?? input.topic,
      summary:
        parsed.summary ??
        `围绕"${input.topic}"生成的一篇${style}公众号草稿。`,
      content: highlightedContent,
    };
  }

  const fallbackSections = sections
    .map((section) => {
      const detail = padText(
        `先讲一个真实场景：有一天我在做${section.heading}相关的事情时，突然意识到之前的方法有个根本性的问题。大多数人（包括以前的我）对${section.heading}的理解只停留在表面。但实际上，真正有效的做法和你想的完全不一样。

下面我会拆成几个具体步骤来说。每一步都附带一个我亲身验证过的检查标准。

第一步，先问自己一个问题：我当前在${section.heading}上最大的瓶颈是什么？把答案写下来，你会发现自己对这件事的认知远比想象中模糊。

第二步，找到那个「最小可行动作」。不是列 20 条计划，而是只做一件事——那件如果不做，其他事都白费的事。

第三步，给自己设一个反馈点。${section.heading}最怕的不是做得慢，而是做了很久才发现方向错了。`,
        perSection * 3,
        section.heading,
      );
      const paragraphs = detail
        .split(/\n+/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para) => {
          if (para.startsWith("<blockquote>")) return para;
          if (para.startsWith("<p>")) return para;
          return `<p>${para}</p>`;
        });
      const hook = `<p><strong>说一个你可能没意识到的点：</strong>${section.heading}这件事，大多数人从一开始就搞错了顺序。</p>`;
      return `
        <section>
          <h2>${section.heading}</h2>
          ${hook}
          ${paragraphs.join("\n          ")}
        </section>
      `.trim();
    })
    .join("\n<hr />\n");

  return {
    title: input.outline?.title ?? input.topic,
    summary: `${input.topic}相关的几个实践思路：结合具体场景说明常见误区，并给出可尝试的下一步动作。`,
    content: `
      <p>上周和一个朋友聊天，他说最近在<strong>${input.topic}</strong>上花了很多时间，进展却不大。我问具体做了什么，他列了几项，我听完觉得：方向大致对，但顺序可能需要调整。</p>
      <p>这篇文章整理的是我在${input.topic}上实践过的思路，不一定适合所有人，希望帮你少绕一些弯路。</p>
      ${fallbackSections}
      <hr />
      <section>
        <h2>总结</h2>
        <div class="mp-summary">
          <p>关于${input.topic}，最重要的不是你知道多少，而是你做了多少。把今天看完最有感触的一个点，今天就用一次。别等「准备好了」——你永远不会准备好。</p>
          <p>真正拉开差距的，从来不是某一天的努力，而是你愿不愿意在还没看到结果的时候，继续把手头的事做好。</p>
        </div>
      </section>
    `.trim(),
  };
}

export async function polishContent(input: {
  content: string;
  mode: "更正式" | "更口语" | "更简洁" | "更营销";
}) {
  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是公众号润色助手。把用户给的 HTML 文章润色成「${input.mode}」风格。要求保留 HTML 结构，输出 JSON：{ "content": string }。

${ARTICLE_HTML_FORMAT_RULES_BRIEF}

【润色原则】
- 提升信息密度，**合并或删除重复段落**，同一观点只保留表达最清晰的一处
- 保留并适当补充 \`<strong>\` 重点标注：每段至少 1 处，标注核心判断或关键术语（2-10 字），禁止删除已有 strong 却不补回
- 润色时不得改变 mp-tip / mp-warning / mp-summary 的固定结构（见上方格式规范）
- 案例不够具体时补充细节，但不可虚构数据来源
- 禁止绝对化表述、空洞鸡汤、夸大承诺、无依据断言
- 「更营销」也只强调真实价值，不用震惊体或虚假宣传`,
    },
    { role: "user", content: input.content },
  ];
  const raw = await callChat(prompt, { jsonMode: true, maxTokens: 2048, role: "polish" });
  const parsed = safeParse<{ content?: string }>(raw, {});
  if (parsed.content && parsed.content.length > 200) {
    return normalizeCalloutBlocks(parsed.content);
  }
  return normalizeCalloutBlocks(input.content);
}

export async function expandSection(input: {
  content: string;
  instruction?: string;
}) {
  const originalPlain = countPlainTextChars(input.content);
  const maxTokens = Math.min(
    8192,
    Math.max(4096, Math.ceil(input.content.length / 2) + 1600),
  );

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content:
        `你是公众号扩写助手。把用户给出的整篇 HTML 正文扩写得更充实，然后输出完整 HTML。

${ARTICLE_HTML_FORMAT_RULES_BRIEF}

【扩写要求】
- 输出 JSON：{ "content": string }，content 必须是扩写后的**完整正文 HTML**（不是增量片段）
- 在各章节内部补充具体案例、步骤、对比或细节，保持原有结构与风格
- 禁止只在文末追加一段；禁止重复粘贴「总结核心动作 / 小练习」等模板套话
- 禁止把原文原样复制后再拼接一遍
- 扩写要有实质信息，不注水、不鸡汤；有判断处可自然用 <strong> 标注 2-8 字核心词
- 禁止绝对化表述和无依据断言；不得引入格式规范以外的 HTML 结构
- 扩写后正文字数应明显多于原文`,
    },
    {
      role: "user",
      content: JSON.stringify({
        content: input.content,
        instruction: input.instruction ?? "补具体例子和执行步骤",
        originalPlainChars: originalPlain,
      }),
    },
  ];

  const raw = await callChat(prompt, { jsonMode: true, maxTokens, role: "expand" });
  if (!raw) {
    throw new Error("未配置 AI API Key，无法扩写");
  }

  const parsed = safeParse<{ content?: string }>(raw, {});
  if (!parsed.content || parsed.content.length < 200) {
    throw new Error("扩写失败：模型未返回有效正文，请重试");
  }

  const expanded = normalizeCalloutBlocks(parsed.content);
  const expandedPlain = countPlainTextChars(expanded);
  if (expandedPlain <= originalPlain + 40) {
    throw new Error("扩写失败：正文几乎没有变长，请重试");
  }

  return expanded;
}

export async function generateTitles(input: {
  topic: string;
  style?: string | null;
  outlineTitle?: string | null;
  contentSummary?: string | null;
  content?: string | null;
}): Promise<Array<{ text: string; style: string }>> {
  const { topic, style, outlineTitle, contentSummary, content } = input;
  const contextParts: string[] = [];
  if (style) contextParts.push(`写作风格：${style}`);
  if (outlineTitle) contextParts.push(`当前标题：${outlineTitle}`);
  if (contentSummary) contextParts.push(`当前摘要：${contentSummary}`);
  if (content) {
    const excerpt = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2500);
    if (excerpt) contextParts.push(`正文节选：${excerpt}`);
  }

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是公众号标题编辑。基于给定主题和上下文，生成 5 个不同风格的标题。

【标题要求】
- 每个标题简洁有力，含 1-2 个核心关键词，不超过 20 字
- 用具体场景、数据暗示或真实疑问吸引点击，禁止标题党和夸大承诺
- 禁止「震惊」「必看」「颠覆」「100%」及「一定要」「绝对」等绝对化表述
- 禁止「：」冒号模板（如「XXX：从入门到精通」）和「深度解析」「一文读懂」等烂词

【风格范式】（每个标题来自不同范式，标注 style）：
1. 提问悬念型：具体问题，暗示文中有依据充分的回答
2. 数字清单型：用数字暗示结构清晰，数字要合理不夸张
3. 对比反差型：「你以为…其实…」，基于真实认知差而非噱头
4. 场景痛感型：描述读者正在经历的具体困境
5. 经验判断型：个人经历得出的谨慎判断，不用绝对语气

输出 JSON：{ "titles": [{ "text": string, "style": string }] }`,
    },
    {
      role: "user",
      content: contextParts.length > 0
        ? `主题：${topic}\n${contextParts.join("\n")}`
        : topic,
    },
  ];

  const raw = await callChat(prompt, { jsonMode: true, maxTokens: 1024, role: "titles" });
  const parsed = safeParse<{ titles?: Array<{ text: string; style: string }> }>(raw, {});

  if (parsed.titles && parsed.titles.length > 0) {
    return parsed.titles.map((t) => ({
      text: t.text,
      style: t.style || "备选",
    }));
  }

  const fallbackStyles = ["提问悬念", "数字清单", "对比反差", "场景痛感", "经验判断"];
  return [
    `为什么你做不好${topic}？答案可能让你意外`,
    `${topic}的 5 个反常识建议（第 3 条我用了 3 年才想通）`,
    `会${topic}和不会${topic}的人，差距不在智商`,
    `如果你也在为${topic}感到焦虑，试试这个办法`,
    `我用 2 年踩完${topic}的所有坑，总结出这几点`,
  ].map((text, i) => ({ text, style: fallbackStyles[i] ?? "备选" }));
}

export async function generateSummary(input: {
  topic: string;
  title?: string | null;
  content?: string | null;
}) {
  const plainContent = (input.content ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (plainContent.length >= 80) {
    const prompt: ChatMessage[] = [
      {
        role: "system",
        content: `你是公众号摘要编辑。根据文章正文提炼一段摘要，用于公众号标题下方展示。
要求：
- 50-120 字，口语自然，信息密度高
- 概括文章核心价值和读者收益，不堆砌关键词
- 禁止标题党、绝对化表述和空洞鸡汤
输出 JSON：{ "summary": string }`,
      },
      {
        role: "user",
        content: JSON.stringify({
          topic: input.topic,
          title: input.title ?? undefined,
          content: plainContent.slice(0, 6000),
        }),
      },
    ];
    const raw = await callChat(prompt, { jsonMode: true, maxTokens: 512, role: "summary" });
    const parsed = safeParse<{ summary?: string }>(raw, {});
    if (parsed.summary && parsed.summary.trim().length >= 20) {
      return {
        summary: parsed.summary.trim(),
        coverText: input.title?.trim() || input.topic,
        source: "content" as const,
      };
    }
  }

  return {
    summary: `这是一篇围绕"${input.topic}"的实用拆解，帮助读者更快理解并开始行动。`,
    coverText: `${input.topic}实用指南`,
    source: "topic" as const,
  };
}

const IMAGE_PROMPT_SYSTEM = `You are an image prompt engineer. Generate clean, descriptive English prompts for a text-to-image model.

CRITICAL: This model ONLY understands natural language. YOU MUST:
- Use plain English description only — describe the visual scene naturally
- NEVER output Midjourney syntax (--v, --ar, --style, --s, --chaos, :: etc.)
- NEVER output Stable Diffusion syntax (negative prompts, weights like (word:1.2), <lora:...>)
- Keep 3-6 sentences, be specific and visual
- The image MUST contain Chinese text as part of the design — specify the exact text and its visual treatment
- No faces or people in the image`;

const IMAGE_STYLE_ANCHOR =
  "Hand-drawn sticker-style educational illustration. Soft macaron color palette. Clean cream/off-white textured paper background. Friendly hand-drawn lines — slightly imperfect, warm, illustrative (children's textbook + modern infographic). Never corporate photorealism.";

const SECTION_LAYOUT_VARIANTS = [
  "HORIZONTAL FLOW: 3-4 rounded sticker cards in a left-to-right row, connected by curved dashed arrows",
  "2x2 GRID: four cards in a balanced grid with subtle connecting dotted lines",
  "CENTRAL HUB: one larger center card with 3 smaller satellite cards around it, linked by thin paths",
  "VERTICAL TIMELINE: cards stacked top-to-bottom along a winding path with step numbers in circles",
  "TWO-COLUMN CONTRAST: left vs right comparison — two tall cards facing each other with a vs/arrow divider",
  "PROCESS FUNNEL: cards arranged in a gentle funnel or pyramid showing progression",
  "RADIAL SPOKES: keyword cards placed around a central icon like a mind-map (no photoreal faces)",
  "LAYERED STACK: 3 cards slightly offset like sticky notes layered on each other with paperclip doodle",
  "JOURNEY MAP: cards placed along a simple winding road/path illustration across the canvas",
  "TOOLBOX SCENE: cards emerging from an open sketch-style toolbox or folder illustration",
] as const;

const SECTION_METAPHOR_VARIANTS = [
  "blueprint / technical sketch grid faintly in background",
  "floating geometric shapes (circles, triangles) as secondary decoration",
  "stationery doodles: paper clips, washi tape strips, pencil shavings",
  "tiny plant sprout and leaf motifs for growth metaphor",
  "cloud and lightning doodles for performance/speed metaphor",
  "puzzle piece connectors between cards",
  "magnifying glass and checklist icons near labels",
  "bridge or link chain connecting two concepts",
  "compass or map pin for navigation/direction metaphor",
  "gear and circuit-line doodles for engineering topics",
] as const;

const SECTION_ACCENT_COLORS = [
  "pastel mint green as dominant accent",
  "soft sky blue as dominant accent",
  "peach coral as dominant accent",
  "lavender lilac as dominant accent",
  "soft lemon yellow as dominant accent",
  "dusty rose pink as dominant accent",
] as const;

function pickSectionVisualVariant(sectionIndex: number) {
  return {
    layout: SECTION_LAYOUT_VARIANTS[sectionIndex % SECTION_LAYOUT_VARIANTS.length],
    metaphor: SECTION_METAPHOR_VARIANTS[sectionIndex % SECTION_METAPHOR_VARIANTS.length],
    accentColor: SECTION_ACCENT_COLORS[sectionIndex % SECTION_ACCENT_COLORS.length],
  };
}

/** 为文章章节生成配图提示词 - 调用 LLM 生成豆包 seedream 兼容 prompt */
export async function generateSectionImagePrompt(
  topic: string,
  _style: string | null,
  sectionHeading: string,
  sectionContext: string,
  options?: { sectionIndex?: number; totalSections?: number },
): Promise<string> {
  const sectionIndex = options?.sectionIndex ?? 0;
  const totalSections = options?.totalSections ?? 1;
  const variant = pickSectionVisualVariant(sectionIndex);

  const prompt = await callChat([
    {
      role: "system",
      content: IMAGE_PROMPT_SYSTEM + `

Create a section illustration for a WeChat article. Keep the unified style anchor below, but make THIS image visually distinct from other sections in the same article.

STYLE ANCHOR (fixed — do not change):
${IMAGE_STYLE_ANCHOR}

DIVERSITY (mandatory — vary composition and decorative elements):
- Each section image must look different from a generic "row of cards" template
- Use the assigned layoutVariant exactly — do not fall back to a default horizontal row unless that IS the assigned layout
- Use the assigned visualMetaphor and accentColor to differentiate mood and decoration
- Vary card shapes subtly when fitting: rounded rects, tags, bookmarks, speech bubbles, hexagons
- Vary decorative doodles: stars, sparkles, arrows, ribbons, plus badges, dots — don't repeat the same set every time
- Pick icons that match the section topic (code brackets, database cylinder, form checkbox, clock, shield, etc.) — not generic lightbulb every time

CONTENT:
- Do NOT just render the section heading as the main text
- Extract 3-5 concrete keywords, methods, tools, or concepts from sectionContent (2-6 Chinese characters each)
- Place each keyword inside its own card/sticker with a small hand-drawn icon
- Do NOT mention aspect ratios or pixel dimensions

Output JSON: { "prompt": string }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        articleTopic: topic,
        sectionHeading,
        sectionContent: sectionContext.slice(0, 800),
        sectionIndex,
        totalSections,
        layoutVariant: variant.layout,
        visualMetaphor: variant.metaphor,
        accentColor: variant.accentColor,
        diversityNote: `Section ${sectionIndex + 1} of ${totalSections} — must NOT look identical to other sections; honor layoutVariant strictly.`,
      }),
    },
  ], { jsonMode: true, maxTokens: 420, role: "section-image" });

  const parsed = safeParse<{ prompt?: string }>(prompt, {});
  if (parsed.prompt) return reinforceSectionPrompt(parsed.prompt, variant);

  const cleanHeading = sectionHeading.replace(/[——\-–—:：]/g, " ").replace(/[^\w\u4e00-\u9fa5 ]/g, "").trim().slice(0, 40);
  return reinforceSectionPrompt(
    `${IMAGE_STYLE_ANCHOR} Illustration about ${cleanHeading}. ${variant.layout}. ${variant.metaphor}. ${variant.accentColor}. Chinese keyword labels inside hand-drawn sticker cards.`,
    variant,
  );
}

function reinforceSectionPrompt(
  prompt: string,
  variant: ReturnType<typeof pickSectionVisualVariant>,
): string {
  const lower = prompt.toLowerCase();
  const hints: string[] = [];
  if (!/macaron|hand-drawn|sticker|cream/i.test(prompt)) {
    hints.push(IMAGE_STYLE_ANCHOR);
  }
  if (!/chinese|中文|汉字/i.test(lower)) {
    hints.push("Chinese keyword labels (2-6 characters) inside each card.");
  }
  if (!/layout|grid|timeline|hub|funnel|map|toolbox|radial|stack/i.test(lower)) {
    hints.push(variant.layout);
  }
  if (hints.length === 0) return prompt.trim();
  return `${prompt.trim()} ${hints.join(" ")}`;
}

/** 从主题/标题/要点提炼封面中文关键词，避免模型编造无关生活类标签 */
function deriveCoverKeywords(
  topic: string,
  title: string,
  keyPoints: string[] = [],
): string[] {
  const candidates: string[] = [];
  const push = (raw: string) => {
    const cleaned = raw
      .replace(/[《》【】\[\]（）()「」""''、，。！？：；]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return;
    for (const part of cleaned.split(/[\s/\-|—–]+/)) {
      const t = part.trim();
      // 封面卡只适合极短标签，过长会画糊或溢出
      if (t.length >= 2 && t.length <= 6) candidates.push(t.slice(0, 6));
    }
  };

  push(topic);
  if (title && title !== topic) push(title.slice(0, 24));
  for (const point of keyPoints.slice(0, 4)) {
    push(point.replace(/[0-9０-９]+[.、．)\]]\s*/g, "").slice(0, 12));
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of candidates) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= 4) break;
  }

  if (result.length >= 3) return result.slice(0, 4);
  if (topic.trim()) return [topic.trim().slice(0, 4), "实践", "方法"].slice(0, 3);
  return ["主题", "方法", "实践"];
}

const LIFESTYLE_COVER_KEYWORD_RE =
  /美食|旅行|旅游|攻略|生活小技巧|文化漫谈|穿搭|护肤|美食推荐|生活方式|理财|星座|情感|养生|家居|亲子/;

function isOffTopicCoverKeyword(keyword: string, topic: string, title: string): boolean {
  if (LIFESTYLE_COVER_KEYWORD_RE.test(keyword)) {
    const corpus = `${topic}${title}`;
    return !LIFESTYLE_COVER_KEYWORD_RE.test(corpus);
  }
  return false;
}

function pickCoverKeywords(
  llmKeywords: string[] | undefined,
  topic: string,
  title: string,
  keyPoints: string[],
): string[] {
  const derived = deriveCoverKeywords(topic, title, keyPoints);
  const fromLlm = (llmKeywords ?? [])
    .map((k) => k.replace(/\s+/g, "").trim())
    .filter((k) => k.length >= 2 && k.length <= 6)
    .filter((k) => !isOffTopicCoverKeyword(k, topic, title));

  if (fromLlm.length >= 3) return fromLlm.slice(0, 4);
  return derived;
}

/** 用英文描述主题域，避免把中文主题原文塞进生图 prompt（易被画到角落） */
function coverDomainHint(topic: string): string {
  const t = topic.toLowerCase();
  if (/agent|智能体/.test(t)) return "AI agents, tools, and automation workflows";
  if (/前端|react|vue|javascript|css|web/.test(t)) return "frontend engineering and AI-assisted coding";
  if (/prompt|提示词/.test(t)) return "prompt engineering and LLM workflows";
  if (/后端|api|服务端/.test(t)) return "backend engineering and APIs";
  if (/产品|运营/.test(t)) return "product thinking and growth tactics";
  return "professional tech knowledge and practical methods";
}

/** 为封面图生成 prompt - 调用 LLM 生成豆包 seedream 兼容 prompt */
export async function generateCoverPrompt(
  topic: string,
  _style?: string | null,
  context?: {
    title?: string | null;
    summary?: string | null;
    keyPoints?: string[];
    contentExcerpt?: string | null;
  },
): Promise<string> {
  const title = context?.title?.trim() || topic;
  const keyPoints = context?.keyPoints ?? [];
  const seedKeywords = deriveCoverKeywords(topic, title, keyPoints);
  const domainHint = coverDomainHint(topic);
  const contentExcerpt = (context?.contentExcerpt ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);

  const prompt = await callChat([
    {
      role: "system",
      content: IMAGE_PROMPT_SYSTEM + `\n\nCreate a cover illustration for a WeChat article. The image MUST visually reflect THIS article's topic — never a generic lifestyle blog cover.

STYLE ANCHOR (fixed):
${IMAGE_STYLE_ANCHOR}

LAYOUT (pick ONE that fits the topic — vary composition, keep style):
- LOWER ARC: 3-4 sticker cards arranged in a gentle arc across the lower third
- DIAGONAL CASCADE: cards staggered diagonally from lower-left to lower-right
- CENTER CLUSTER: one hero card with 2-3 smaller cards grouped below it
- SPLIT BAND: cards sitting on a hand-drawn colored band/strip across the lower area

KEYWORD RULES (critical):
- Output 3-4 Chinese keywords, each EXACTLY 2-6 characters — short labels only (e.g. 前端、Agent、Prompt)
- Keywords ONLY from articleTopic / articleTitle / summary / keyPoints
- FORBIDDEN unless the article itself is about them: 美食推荐、旅行攻略、生活小技巧、文化漫谈、穿搭、护肤、理财、星座
- Seed keywords for reference: ${JSON.stringify(seedKeywords)}
- Icons/metaphors MUST match domain (${domainHint}) — not food/travel/home

TEXT PLACEMENT (absolute — image models often ignore this, so be extreme):
- The UPPER HALF of the image must be completely blank of ALL text — no Chinese, no English, no topic, no title, no tags
- ESPECIALLY forbid text in the top-left corner, top-right corner, and top-center
- The ONLY Chinese text in the whole image is the short keywords INSIDE the lower sticker cards
- Never paint articleTopic / articleTitle / summary as a header or corner watermark
- Do not write words like "title", "topic", or the raw topic string anywhere on the canvas

Output JSON: { "prompt": string, "keywords": string[] }
In "prompt": describe visuals in English; when mentioning card labels, list ONLY the short keywords. Never quote the full article topic/title as text to draw.`,
    },
    {
      role: "user",
      content: JSON.stringify({
        domainHint,
        // 仅作语义上下文，明确禁止绘制这些完整字符串
        contextForMeaningOnly: {
          articleTopic: topic,
          articleTitle: title,
          summary: context?.summary || "",
          keyPoints,
          contentExcerpt: contentExcerpt || undefined,
        },
        doNotPaintTheseStrings: [topic, title].filter(Boolean),
        preferredKeywords: seedKeywords,
      }),
    },
  ], { jsonMode: true, maxTokens: 420, role: "cover-prompt" });

  const parsed = safeParse<{ prompt?: string; keywords?: string[] }>(prompt, {});
  const keywords = pickCoverKeywords(parsed.keywords, topic, title, keyPoints);

  if (parsed.prompt) {
    return reinforceCoverPrompt(parsed.prompt, keywords, topic, title);
  }

  return reinforceCoverPrompt(
    `${IMAGE_STYLE_ANCHOR} WeChat article cover about ${domainHint}. ` +
      `Lower third only: 3-4 macaron sticker cards labeled exactly ${keywords.map((k) => `"${k}"`).join(", ")}. ` +
      `Topic-relevant hand-drawn icons (code brackets, agent nodes, workflow arrows — not food/travel). ` +
      `Upper half completely empty of text. No corner labels. No floating titles.`,
    keywords,
    topic,
    title,
  );
}

/** 追加封面约束：禁止角落标题，只允许卡片内短关键词 */
function reinforceCoverPrompt(
  prompt: string,
  keywords: string[],
  topic: string,
  title: string,
): string {
  let cleaned = prompt.trim();

  // 去掉 prompt 里容易被模型「照抄上屏」的整段主题/标题引文
  for (const raw of [title, topic]) {
    const t = raw?.trim();
    if (!t || t.length < 2) continue;
    if (keywords.includes(t)) continue;
    cleaned = cleaned.split(t).join("the article subject");
  }

  const hints = [
    "UPPER HALF of the image: absolutely no text of any kind (no Chinese, no English, no logos).",
    "No text in top-left corner, top-right corner, or top-center — leave blank cream background only.",
    `The ONLY Chinese text allowed anywhere in the image: ${keywords.map((k) => `「${k}」`).join("、")} — each written once, only inside lower sticker cards.`,
    "Do not print the article topic or title as a separate header, watermark, or corner tag.",
    "Card labels must be short (2-6 Chinese characters). Never put long sentences on cards.",
  ];

  if (LIFESTYLE_COVER_KEYWORD_RE.test(cleaned) && !LIFESTYLE_COVER_KEYWORD_RE.test(topic)) {
    hints.push(
      "Remove any lifestyle labels such as 美食推荐/旅行攻略/生活小技巧/文化漫谈 — they are off-topic.",
    );
  }

  return `${cleaned} ${hints.join(" ")}`;
}

export async function runRiskCheck(title: string, content: string) {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (title.includes("最") || title.includes("一定")) {
    issues.push("标题存在绝对化表达，可能偏夸张。");
    suggestions.push("把「最」「一定」等词替换为更克制的描述。");
  }

  if (content.length < 300) {
    issues.push("正文偏短，可能不足以支撑一篇完整公众号文章。");
    suggestions.push("建议补充案例、步骤说明或结尾互动段落。");
  }

  return {
    score: Math.max(60, 100 - issues.length * 12),
    issues,
    suggestions,
  };
}

export type { TextRole };
