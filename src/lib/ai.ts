import type { OutlineOption } from "@/types/article";
import { getEnvValue } from "@/lib/config-bridge";
import { highlightCodeBlocks } from "@/lib/code-highlight";

type TextRole = "outline" | "content" | "summary" | "titles" | "cover-prompt" | "polish" | "expand" | "section-image";

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

/** 运行时读取 LLM 配置（非模块常量，确保每次都读最新值） */
function getLLMConfig() {
  return {
    model: readConfig("TEXT_MODEL_NAME", "gpt-4o-mini"),
    baseUrl: readConfig("AI_BASE_URL", "https://api.openai.com/v1"),
  };
}

async function callChat(messages: ChatMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }) {
  const jsonMode = opts?.jsonMode ?? true;
  const maxTokens = opts?.maxTokens ?? 2048;

  const apiKey = getEnvValue("AI_API_KEY") ?? process.env.AI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const { model, baseUrl } = getLLMConfig();

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

  const raw = await callChat(prompt, { jsonMode: true, maxTokens: 2048 });
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
- 章节用 <h2>，小节用 <h3>；章节之间用 <hr /> 隔开
- 每个 <h2> 章节只推进**一个**新论点，写透即收，不重复前面章节已说的结论
- 每段只表达一层意思，段首点题即可；段间用一句过渡衔接，禁止段段都用「但真正的问题是…」套话
- 步骤类内容用 <ol>，并列要点用 <ul>，列表项之间不得语义重复
- 列表若采用「标题+说明」结构，写法：<li><strong>标题</strong>说明正文（同一行紧接，不要 <br>，不要单独一行冒号）</li>

【内容层次（全文交替，非每章堆砌）】
- 案例、数据、正反面观点在**全文**自然分布即可，不要求每个章节都凑齐「道理+案例+数据+反面」
- 同一案例或同一判断全文最多出现 1 次；后文引用时用「前面提到的…」一句带过，禁止整段重写
- 需要深度时解释「为什么」，但不要用不同措辞把同一结论说三遍
- 专业概念首次出现时用生活化语言或 <code> 简短解释

【段落节奏与轻重点】
- 长句与短句交替，每段不超过 4 句
- <strong> 只在有判断、转折、结论处加，2-8 字短语，一段 0-2 处
- blockquote / mp-tip / mp-warning 全篇各最多 2 次，且必须承载**正文未展开的新信息**，不得把正文原话换个盒子再贴一遍

【结构组件】
- <blockquote>：非常规但值得单独品味的判断
- <div class="mp-tip">：可执行步骤（做什么、怎么做、预期结果）
- <div class="mp-warning">：具体踩坑场景与规避方式
- 结尾 <h2>总结</h2> + <div class="mp-summary">：用 2-3 句**提炼**全文，给 1 个小行动或思考题；禁止逐章回顾、禁止复述正文原句

【反重复（硬性）】
- 禁止用同义词改写重复同一观点（如先说「顺序错了」，后又说「关键在于先后」）
- 禁止开头、正文、总结三处讲同一个故事或同一个例子
- 禁止每个章节结尾都写「所以最重要的是…」式收束
- 若某观点已在 tip/warning/blockquote 里完整表达，正文不要再展开一遍
- 写完后通读：任意两段去掉一段，文章是否仍然完整？若是，则删掉冗余段

【质量标准】
- 信息密度：每段都有新信息，零重复、零正确的废话
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
- 目标篇幅约 ${wordCount} 字，按大纲章节自然展开即可；**宁短勿水**，不为凑字数重复观点
- 每个章节围绕大纲 summary 写一个新角度，不复述其他章节的结论`,
    },
    {
      role: "user",
      content: JSON.stringify(
        buildWritingUserPayload({
          topic: input.topic,
          style,
          wordCount,
          audience: input.audience,
          goal: input.goal,
          keywords: input.keywords,
          outline: input.outline,
        }),
      ),
    },
  ];

  const raw = await callChat(prompt, { jsonMode: true, maxTokens: 4096 });
  const parsed = safeParse<{ title?: string; summary?: string; content?: string }>(
    raw,
    {},
  );

  if (parsed.content && parsed.content.length > 600) {
    // 安全清理：去掉任何 LLM 可能误生成的 h1 和 mp-signature
    const safeContent = parsed.content
      .replace(/<h1[^>]*>[\s\S]*?<\/h1>/g, "")
      .replace(/<div class="mp-signature">[\s\S]*?<\/div>/g, "");
    // 后处理：检测并修复未被 <pre><code> 包裹的代码块
    const fixedContent = dedupeRepeatedBlocks(fixCodeBlocks(safeContent));
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
      content: `你是公众号润色助手。把用户给的 HTML 文章润色成「${input.mode}」风格。要求保留 HTML 结构（h2/h3/p/hr/blockquote/div class="mp-tip|mp-warning|mp-summary"/strong/code），输出 JSON：{ "content": string }。

【润色原则】
- 提升信息密度，**合并或删除重复段落**，同一观点只保留表达最清晰的一处
- 根据内容自然调整 <strong>，不机械加粗
- 案例不够具体时补充细节，但不可虚构数据来源
- 禁止绝对化表述、空洞鸡汤、夸大承诺、无依据断言
- 「更营销」也只强调真实价值，不用震惊体或虚假宣传`,
    },
    { role: "user", content: input.content },
  ];
  const raw = await callChat(prompt, { jsonMode: true, maxTokens: 2048 });
  const parsed = safeParse<{ content?: string }>(raw, {});
  if (parsed.content && parsed.content.length > 200) {
    return parsed.content;
  }
  return input.content;
}

export async function expandSection(input: {
  content: string;
  instruction?: string;
}) {
  const prompt: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是公众号扩写助手。扩写用户给出的 HTML 段落，输出 JSON：{ \"content\": string }。保持 HTML 结构和整体风格，补充具体案例、步骤或细节。扩写要有实质信息，不注水、不鸡汤；有判断处可自然用 <strong> 标注 2-8 字核心词；禁止绝对化表述和无依据断言。",
    },
    {
      role: "user",
      content: JSON.stringify({
        content: input.content,
        instruction: input.instruction ?? "补具体例子和执行步骤",
      }),
    },
  ];
  const raw = await callChat(prompt, { jsonMode: true, maxTokens: 2048 });
  const parsed = safeParse<{ content?: string }>(raw, {});
  if (parsed.content && parsed.content.length > 200) {
    return parsed.content;
  }
  return padText(
    input.content,
    Math.max(input.content.length + 600, 800),
    "扩写段落",
  );
}

export async function generateTitles(input: {
  topic: string;
  style?: string | null;
  outlineTitle?: string | null;
  contentSummary?: string | null;
}) {
  const { topic, style, outlineTitle, contentSummary } = input;
  const contextParts: string[] = [];
  if (style) contextParts.push(`写作风格：${style}`);
  if (outlineTitle) contextParts.push(`大纲标题：${outlineTitle}`);
  if (contentSummary) contextParts.push(`内容摘要：${contentSummary}`);

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

  const raw = await callChat(prompt, { jsonMode: true, maxTokens: 1024 });
  const parsed = safeParse<{ titles?: Array<{ text: string; style: string }> }>(raw, {});

  if (parsed.titles && parsed.titles.length > 0) {
    return parsed.titles.map((t) => t.text);
  }

  // fallback titles with diverse styles
  return [
    `为什么你做不好${topic}？答案可能让你意外`,
    `${topic}的 5 个反常识建议（第 3 条我用了 3 年才想通）`,
    `会${topic}和不会${topic}的人，差距不在智商`,
    `如果你也在为${topic}感到焦虑，试试这个办法`,
    `我用 2 年踩完${topic}的所有坑，总结出这几点`,
  ];
}

export function generateSummary(topic: string) {
  return {
    summary: `这是一篇围绕"${topic}"的实用拆解，帮助读者更快理解并开始行动。`,
    coverText: `${topic}实用指南`,
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

/** 为文章章节生成配图提示词 - 调用 LLM 生成豆包 seedream 兼容 prompt */
export async function generateSectionImagePrompt(
  topic: string,
  _style: string | null,
  sectionHeading: string,
  sectionContext: string,
): Promise<string> {
  const prompt = await callChat([
    {
      role: "system",
      content: IMAGE_PROMPT_SYSTEM + `\n\nCreate a visual illustration for a specific section of an article. The image must VISUALLY REPRESENT the concrete concepts and ideas discussed in this section. Do NOT mention aspect ratios, dimensions, or format specs in the prompt.

Style: Hand-drawn sticker-style educational illustration. Soft macaron color palette (pastel pink, mint green, soft yellow, sky blue, peach). Clean cream/off-white textured background. Each key point is presented as a separate rounded card with a soft drop shadow and a hand-drawn icon (simple sketch icon for the concept). Cards arranged in a flowing horizontal layout (left-to-right or grid). Decorative doodle elements scattered around: small stars, sparkles, tiny pencils, arrows, plus-sign badges, ribbons. Crisp Chinese text labels inside each card (one short keyword 2-6 Chinese characters per card). All hand-drawn elements have slightly imperfect, friendly lines — never corporate, never realistic. Atmosphere: friendly, educational, warm, illustrative (think children's textbook + modern infographic).

LAYOUT OPTIONS (pick one per image, vary across sections):
- HORIZONTAL ROW: 3-4 cards laid out left-to-right with small connecting arrows between them
- 2x2 GRID: four cards arranged in a 2-by-2 grid
- TWO-COLUMN COMPARE: two cards side by side showing contrasting concepts
- PROCESS FLOW: sequence of cards connected by curved arrows showing steps

CRITICAL: Do NOT just display the section heading as text. Instead, extract the most important technical keywords, methods, tools, or concepts from the section content and use THOSE as the text labels inside each card. Each card label should be 2-6 Chinese characters.

Output JSON: { "prompt": string }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        articleTopic: topic,
        sectionHeading,
        sectionContent: sectionContext.slice(0, 800),
      }),
    },
  ], { jsonMode: true, maxTokens: 256 });

  const parsed = safeParse<{ prompt?: string }>(prompt, {});
  if (parsed.prompt) return parsed.prompt;

  // fallback
  const cleanHeading = sectionHeading.replace(/[——\-–—:：]/g, " ").replace(/[^\w\u4e00-\u9fa5 ]/g, "").trim().slice(0, 40);
  return `clean infographic illustration about ${cleanHeading}, flat vector style, modern minimal, 1920x1920`;
}

/** 为封面图生成 prompt - 调用 LLM 生成豆包 seedream 兼容 prompt */
export async function generateCoverPrompt(
  topic: string,
  _style?: string | null,
  context?: { title?: string | null; summary?: string | null; keyPoints?: string[] },
): Promise<string> {
  const title = context?.title?.trim() || topic;

  const prompt = await callChat([
    {
      role: "system",
      content: IMAGE_PROMPT_SYSTEM + `\n\nCreate a cover illustration for a WeChat article. The image MUST visually reflect the specific topic — do NOT create a generic cover. Do NOT mention aspect ratios, dimensions, or format specs in the prompt — the image size is handled separately.

Style: Hand-drawn sticker-style educational illustration. Soft macaron color palette (pastel pink, mint green, soft yellow, sky blue, peach). Clean cream/off-white textured background. Key concepts presented as rounded cards with soft drop shadows and hand-drawn icons. Decorative doodle elements: small stars, sparkles, tiny pencils, arrows, plus-sign badges, ribbons. All hand-drawn, friendly, slightly imperfect lines — never corporate, never realistic. No faces or people.

LAYOUT (strict — must follow):
- The top 40% of the image must contain ZERO text — no title, no keywords, no captions. Only plain cream background and tiny decorative doodles (stars/sparkles) are allowed. WeChat will overlay the article title here later.
- Place 3-5 rounded sticker cards horizontally in the lower-center area (below the empty top zone).
- ALL Chinese text must appear ONLY inside those cards — never floating outside cards, never in corners, never as a large header.

TEXT (strict):
- Extract 3-5 distinct core Chinese keywords (2-6 characters each) from topic, summary, and keyPoints.
- Do NOT render the full article title anywhere in the image.
- articleTitle in user input is context only — never paint it on the cover.
- Each keyword appears exactly once inside one card. Do not repeat the same word as both a corner title and a card label.

Output JSON: { "prompt": string }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        articleTopic: topic,
        articleTitleContextOnly: title,
        summary: context?.summary || "",
        keyPoints: context?.keyPoints || [],
      }),
    },
  ], { jsonMode: true, maxTokens: 256 });

  const parsed = safeParse<{ prompt?: string }>(prompt, {});
  if (parsed.prompt) return reinforceCoverPrompt(parsed.prompt);

  // fallback：不写标题文字，避免模型在角落渲染标题
  return (
    "Hand-drawn sticker-style WeChat article cover illustration. Soft macaron pastel cards with Chinese keyword labels inside cards only. " +
    "Top 40 percent completely empty of text, plain cream background with tiny star doodles. " +
    "Cards with icons arranged horizontally in lower center. No floating text, no corner titles, no article headline."
  );
}

/** 追加封面约束，降低模型在空白区乱加标题的概率 */
function reinforceCoverPrompt(prompt: string): string {
  const lower = prompt.toLowerCase();
  const hints: string[] = [];
  if (!/top 40|upper 40|top area|no text in the top/i.test(prompt)) {
    hints.push("Top 40% of image has no text at all, only plain background.");
  }
  if (!/inside card|within card|only inside/i.test(lower)) {
    hints.push("All Chinese text appears only inside sticker cards, never in corners or as floating headers.");
  }
  if (!/do not.*title|never.*title|no article title/i.test(lower)) {
    hints.push("Do not render the article title or duplicate keywords outside cards.");
  }
  if (hints.length === 0) return prompt;
  return `${prompt.trim()} ${hints.join(" ")}`;
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
