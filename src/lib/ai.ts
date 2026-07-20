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

【核心要求】
- 每个大纲必须有鲜明差异：不同的切入角度、不同的叙事节奏、不同的说服策略。
- 方案之间要有「选 A 还是选 B」的张力，而不是同一个骨架换了几个词。
- 目标读者：${audience}，写作风格：${style}，目标字数：${wordCount} 字。

【标题多样性要求】
每个大纲的 title 必须来自不同的标题范式，禁止重复使用同一范式：
1. 悬念/提问型——如「为什么你做不好XXX」「XXX的真正瓶颈是什么」
2. 数字清单型——如「XXX的 3 个反直觉真相」「5 个让你效率翻倍的XXX技巧」
3. 对比/反差型——如「会XXX的人 vs 不会XXX的人，差距在哪里」
4. 场景代入型——如「如果你也在为XXX焦虑，这篇文章是写给你的」
5. 方法论/指南型——如「XXX实战手册：从入门到精通」「一份可复制的XXX行动方案」
6. 观点/态度型——如「我用了 3 年才明白：XXX根本不是你想的那样」
标题语言要自然、有呼吸感，避免「：」冒号模板句式堆砌。

【章节多样性要求】
每个大纲的章节标题必须：
- 避免「什么是XXX」「XXX的重要性」「XXX的优缺点」这种教科书式标题
- 优先使用：设问句、动作引导、具体场景、反常识判断、数据暗示
- 章节之间要有逻辑递进（不是平行罗列），让读者有「看完这节必须看下一节」的驱动力

【输出格式】
JSON 数组，每个元素包含：
- title: 文章标题（有吸引力，15-25 字）
- positioning: 一句话说明这个方案的定位和适合什么类型的读者（15-30 字）
- sections: 章节数组，每项 { heading: string, summary: string }
输出 { "outlines": [...] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        topic: input.topic,
        style,
        wordCount,
        audience,
        goal: input.goal,
        outlineCount: count,
        sectionsPerOutline: sectionCount,
      }),
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
}) {
  const style = input.style || "干货型";
  const wordCount = input.wordCount ?? 1200;
  const sections = input.outline?.sections ?? buildSections(input.topic);
  const perSection = Math.max(280, Math.floor(wordCount / Math.max(sections.length, 1)));

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是一位写了 8 年公众号的资深主笔，读者评价你的文章「像朋友在聊天但每句都有信息量」。请基于给定大纲，写一篇完整的微信公众号文章。

【写作人格】
- 第一人称「我」贯穿全文，展示真实的思考过程和亲身经验，不要扮演「专家」角色
- 用「你」直接和读者对话，像深夜给朋友发长消息分享一个你刚想通的道理
- 每写到一个观点，立刻跟一个具体的、你「亲身经历过」的场景或例子
- 敢于表达个人观点和判断，不怕说「我认为」「我试过之后发现」「大多数人搞反了」

【开头要求】
- 禁止用「在当今时代」「随着XX的发展」「近年来」等模板化开头
- 可以直接从一个具体场景切入：「上周三晚上，我盯着屏幕看了半小时，突然意识到……」
- 或者用一个反常识的判断开头：「如果你觉得XXX很难，那可能是因为你一直在用错误的方法」
- 开头段不超过 3 句话，让读者能在手机上一屏读完

【段落节奏】
- 长句（20+ 字）和短句（3-8 字）交替使用，制造阅读节奏感
- 每段不超过 4 句话，避免「文字墙」
- 关键观点单独成段，用 <strong> 强调核心判断词
- 每写完 2-3 段正文，插入一个让读者「停顿思考」的句子

【结构要求】
- 内容中不要包含 <h1> 主标题（主标题会单独处理），章节标题用 <h2>，小节用 <h3>
- 每个章节开头第一句必须是「钩子」——一个让人想继续读的悬念、问题或反常识判断
- 章节之间用 <hr /> 隔开
- 反直觉观点或金句用 <blockquote> 完整引用，形成视觉锚点
- 操作建议用 <div class="mp-tip">...</div> 包裹，内容要具体可执行
- 避坑提醒用 <div class="mp-warning">...</div> 包裹
- 列举用 <ul> 或 <ol> 结构化，每个列表项要有实质性内容
- 结尾用 <h2>总结</h2> 章节，3-5 句话呼应开头，让读者有「读完值得」的满足感

【语言质量红线】
- 禁止使用：赋能、抓手、闭环、底层逻辑、降维打击、颗粒度、对齐、倒逼、深挖
- 禁止空洞的「鸡汤」：没有具体例子的道理=白写
- 禁止在结尾引导关注、点赞、转发——只总结内容本身
- 句子要能读出声：写完默读一遍，如果念起来别扭就重写

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
- title：文章主标题（15-25 字，有吸引力，不使用冒号模板句）
- summary：80-120 字的内容摘要
- content：完整 HTML（不含 <article>、<h1>，不含签名和关注引导）
- 全文不少于 ${wordCount} 字（中文计字符），每个章节不少于 ${perSection} 字`,
    },
    {
      role: "user",
      content: JSON.stringify({
        topic: input.topic,
        style,
        wordCount,
        outline: input.outline,
      }),
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
    const fixedContent = fixCodeBlocks(safeContent);
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
    summary: `${input.topic}这件事，方法比努力重要得多。这篇文章不讲大道理，只分享我亲身试过、真正有效的几个动作，读完就能用。`,
    content: `
      <p>上周和一个朋友聊天，他说最近在<strong>${input.topic}</strong>上花了很多时间但没什么进展。我问他具体做了什么，他列了一堆，我听完只有一个感受：方向没错，但顺序全反了。</p>
      <p>这篇文章是我自己在${input.topic}上踩了两年坑之后整理出来的思路。不保证适合所有人，但至少能让你少做 80% 的无用功。</p>
      ${fallbackSections}
      <hr />
      <section>
        <h2>总结</h2>
        <p>关于${input.topic}，最重要的不是你知道多少，而是你做了多少。把今天看完最有感触的一个点，今天就用一次。别等「准备好了」——你永远不会准备好。</p>
        <p>真正拉开差距的，从来不是某一天的努力，而是你愿不愿意在还没看到结果的时候，继续把手头的事做好。</p>
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
      content: `你是公众号润色助手。把用户给的 HTML 文章润色成「${input.mode}」风格。要求保留 HTML 结构（h1/h2/p/hr），内容 JSON：{ "content": string }。`,
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
        "你是公众号扩写助手。扩写用户给出的 HTML 段落，输出 JSON：{ \"content\": string }。注意保持 HTML 结构、保持整体风格不变，并补充例子或细节。",
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
      content: `你是公众号爆款标题专家。基于给定主题和上下文，生成 5 个不同风格的标题，要求如下：

【标题风格范式】（每个标题来自不同范式，标注其范式）：
1. 提问悬念型：用一个让人忍不住想点开的问题开头，暗示文章里有答案
2. 数字清单型：用具体数字降低读者认知负担，暗示内容结构化、可速读
3. 对比反差型：用「A vs B」或「你以为…其实…」制造认知冲突
4. 场景痛感型：描述一个读者正在经历的具体痛点，暗示这里有解法
5. 态度金句型：用强烈的个人观点或反常识判断，建立作者人格

【质量要求】
- 每个标题 12-25 字，自然口语化，读起来像一个人在说话而不是 AI 生成的
- 禁止使用「：」冒号模板结构（如「XXX：从入门到精通」）
- 禁止使用「深度解析」「一文读懂」「干货分享」等被用烂的词汇
- 优先使用动词开头、具体数字、个人经历暗示

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
      content: IMAGE_PROMPT_SYSTEM + `\n\nCreate a cover illustration for a WeChat article. The image MUST visually reflect the specific topic — do NOT create a generic cover. The top 40% should be clean for title overlay. Do NOT mention aspect ratios, dimensions, or format specs in the prompt — the image size is handled separately.

Style: Hand-drawn sticker-style educational illustration. Soft macaron color palette (pastel pink, mint green, soft yellow, sky blue, peach). Clean cream/off-white textured background. Key concepts presented as rounded cards with soft drop shadows and hand-drawn icons. Decorative doodle elements: small stars, sparkles, tiny pencils, arrows, plus-sign badges, ribbons. All hand-drawn, friendly, slightly imperfect lines — never corporate, never realistic. No faces or people.

TEXT REQUIREMENT: Extract 3-5 core Chinese keywords from the article topic and summary, and display them as Chinese text labels inside sticker cards arranged across the composition. Each card has one keyword (2-6 Chinese characters) with a hand-drawn icon. Do NOT just show the article title — use the underlying technical keywords that define what the article is about. Output JSON: { "prompt": string }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        articleTopic: topic,
        articleTitle: title,
        summary: context?.summary || "",
        keyPoints: context?.keyPoints || [],
      }),
    },
  ], { jsonMode: true, maxTokens: 256 });

  const parsed = safeParse<{ prompt?: string }>(prompt, {});
  if (parsed.prompt) return parsed.prompt;

  // fallback
  const cleanTitle = title.replace(/[——\-–—:：|｜《》""''「」『』【】\[\]（）\(\)]/g, " ").trim().slice(0, 60);
  return `WeChat article cover about ${cleanTitle}, clean modern design, abstract geometric elements, warm professional tones, 2560x1440`;
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
