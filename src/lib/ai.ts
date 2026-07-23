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
  const primaryBaseUrl = normalizeChatBaseUrl(
    readConfig("AI_BASE_URL", "https://api.openai.com/v1"),
  );
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
    baseUrl: normalizeChatBaseUrl(auxiliaryBaseUrl || primaryBaseUrl),
    apiKey: auxiliaryApiKey || primaryApiKey,
  };
}

function normalizeChatBaseUrl(raw: string): string {
  const base = raw.trim().replace(/\/+$/, "");
  if (!base) return "https://api.openai.com/v1";
  // DeepSeek 等常见填成 https://api.deepseek.com，需补 /v1
  if (/^https?:\/\/api\.deepseek\.com$/i.test(base)) {
    return `${base}/v1`;
  }
  return base;
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

  const timeoutMs = getLlmTimeoutMs(role);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LLM request failed: ${res.status} ${errBody.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
    };

    return json.choices[0]?.message?.content ?? "";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `LLM 请求超时（${Math.round(timeoutMs / 1000)} 秒）。请检查模型服务/网络后重试；大纲一般应在 1～2 分钟内返回。`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getLlmTimeoutMs(role: TextRole): number {
  const raw = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  // 工程长主题 + 多套大纲时，模型常需 2～5 分钟；超时过紧会误杀
  if (role === "content" || role === "polish" || role === "expand") return 480_000; // 8 分钟
  if (role === "outline") return 420_000; // 7 分钟
  return 180_000; // 其它短任务 3 分钟
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
    `- 技术/编程类：以可运行代码、接口约定、边界与踩坑为主；术语用 <code> 标注；少写「意义/趋势」空话\n` +
    `- 产品/商业类：用决策过程、对比选项、具体数字或结果；少堆术语正确但无用的正确废话\n` +
    `- 成长/生活/科普类：用可核对的场景、人物动作、前后对比；道理从事实里长出来，不要先贴标签再硬凑例子\n` +
    `- 判断领域时看主题语义，不看账号名称`
  );
}

/** 从主题/关键词判断是否工程实现向（组件封装、上传、API 等） */
function isEngineeringTopic(topic: string, keywords?: string | null): boolean {
  const text = `${topic} ${keywords ?? ""}`.toLowerCase();
  const signals = [
    /前端|后端|全栈|工程|封装|组件|hooks?|react|vue|angular|svelte|typescript|javascript|node\.?js/,
    /上传|下载|分片|断点续传|并发|sdk|api|接口|cli|docker|k8s|数据库|sql|redis/,
    /代码|源码|实现|重构|架构|中间件|插件|npm|webpack|vite|bundler|css|html/,
    /component|upload|chunk|resume|typescript|javascript|python|golang|rust|java/,
  ];
  return signals.some((re) => re.test(text));
}

function buildOnTopicBlock(topic: string, keywords?: string | null): string {
  const kw = parseKeywords(keywords);
  const kwHint = kw.length > 0 ? `关键词（可自然融入，勿生硬堆砌）：${kw.join("、")}` : "无额外关键词";
  return `
【紧扣主题（硬性）】
- 用户主题是写作边界的圆心：「${topic}」。可以在主题内深挖、举例、对比、拆步骤，**禁止跑到无关赛道**
- ${kwHint}
- 允许扩展：同一主题下的前置条件、边界情况、常见误区、可执行下一步——但每段读完应能回答「这和主题有什么关系」
- 禁止借题发挥：不要用主题当引子，后文滑向成功学、行业趋势、空洞励志或账号人设广告
- 若某章节写着写着偏了：删掉偏题部分，回到主题的一个具体问题
`.trim();
}

function buildEvidenceBlock(engineering: boolean): string {
  if (engineering) {
    return `
【论据与干货（工程向）】
- 凡主张「该怎么做」，必须落到代码、接口字段、状态、命令或可复现步骤之一
- 禁止只有「要注意并发 / 要做好封装」这类正确但无法下手的句子；要么给代码/伪代码，要么给检查清单
- 案例优先写「我当时怎么做的 / 错在哪 / 改完长什么样」，少写「业界普遍认为」
`.trim();
  }
  return `
【论据与干货（通用）】
- 凡给出建议、判断、方法，至少配一种支撑：具体案例、前后对比、可核对数字、对话/场景片段、步骤清单
- 科普/生活/观点文不要求代码；但**不能只有定义和态度**——读者读完要带走能用的东西（怎么判断、怎么试、会踩什么坑）
- 若某章偏实践（教程、操作、避坑）：必须有可跟随步骤或真实情境，禁止纯概念铺陈
- 若某章偏认知（观点、科普）：用一个具体现象/故事钉住论点，再讲机制；不要反过来先空讲大词
`.trim();
}

function buildQualityArticleBlock(): string {
  return `
【向优质文章靠拢（写作标准）】
优质公众号/专栏常见共性，请按此自检：
1. **一句主线**：全文只打穿一个核心问题；小节都是主线的分支，不是百科条目拼盘
2. **先问题后展开**：开篇直接点出读者真正卡的问题或核心结论，再展开概念（需要多少讲多少）；不要用虚构闲聊铺垫
3. **信息密度**：删掉后不影响理解的句子一律删；同一意思不换词再说一遍
4. **可感知细节**：时间、数量、报错原文、界面状态、代码行为——比「很重要/很关键」更有说服力
5. **诚实边界**：写清适用条件与做不到的部分；夸大承诺会立刻像营销稿
6. **结尾给带走物**：一个可执行动作、一张检查表、或一个判断标准——不要升华成口号

禁止的空洞写法：
- 只抛概念不下定义也不举例
- 「本质上是认知问题」「关键在于体系化」却不说具体改哪一步
- 排比正确废话、假装深刻的对立（旧时代 vs 新时代）却无事实
- 用「和朋友聊天 / 有人问我 / 上周同事说」这类虚构闲聊当万能开头
`.trim();
}

function buildEngineeringOutlineBlock(enabled: boolean): string {
  if (!enabled) return "";
  return `
【工程/封装类主题——大纲硬性要求】
- 标题若含「实战 / 手册 / 封装 / 手把手 / 从 0 到 1」，章节必须对应**可交付物**（接口、代码片段、目录结构、边界用例），禁止只有概念章节
- 至少 3 个章节的 summary 要写清「本章会给出什么」：如 Props 设计、分片队列伪代码、错误码表、断点续传时序——不要写「全面介绍XXX」
- 禁止整篇大纲落成：重要性 → 原理 → 方法论 → 注意事项 → 总结（教科书骨架）
- 鼓励差异化骨架（可混用，勿套固定句式）：
  · 先接口后实现（对外 API → 内部状态机 → 边界）
  · 先翻车后正解（真实坑 → 根因 → 最终实现）
  · 最小可用切片（先跑通一条路径，再补并发/续传）
  · 对比选型（原生 / 库 / 自研，各给一段关键代码）
- 章节标题要像工程师笔记：可含具体名词（\`File\`、\`Blob\`、\`concurrent\`、\`etag\`），少用「赋能认知」「底层逻辑」
`.trim();
}

function buildEngineeringContentBlock(enabled: boolean): string {
  if (!enabled) return "";
  return `
【工程/封装类主题——正文硬性要求】
- **标题承诺必须兑现**：标题/大纲写「实战、手册、封装」，正文必须有可运行或可粘贴的代码；禁止通篇概念与鸡汤
- **代码量**：全文至少 **2** 个 \`<pre><code>\` 代码块（建议 TypeScript/JS）；至少 1 个展示核心 API 或关键流程（≥8 行）
- **少说多写**：用代码、类型定义、调用示例代替「首先要理解…」「本质上是…」长段空论
- 每个涉及实现的 <h2>：先给一段可落地的代码或接口，再用 1-2 段说明「为什么这样写 / 边界」
- 允许省略完整工程脚手架，但关键逻辑（分片、并发池、重试、进度、取消）必须有代码或清晰伪代码
- 禁止用「步骤一/二/三」空壳凑字：每一步都要落到函数名、参数或状态字段
- 若字数与信息密度冲突：**优先信息密度**，宁可略短，也不要注水重复
`.trim();
}

function buildAntiAiVoiceBlock(): string {
  return `
【去 AI 腔与夸夸其谈（硬性）】
- 禁止套话：在当今/随着…发展/赋能/抓手/闭环/底层逻辑/降维/颗粒度/对齐/沉淀方法论/打造闭环/深度思考
- 禁止每个大纲都长成：痛点引入 → 三大误解 → 三步方法论 → 注意事项 → 总结（换词不算创新）
- 标题禁止批量套用同一公式；「XXX实战手册」最多在全部方案里出现 1 次，且该方案必须可落地
- 少用抽象形容词（赋能、卓越、全面、系统性）；改用可观察事实
- 允许不完美与取舍：真实感强于完美教条
- **禁止「闲聊代入」开篇模板**：如「周一/上周和一个朋友聊天」「同事问我」「有读者留言说最近在XXX上花了很多时间，进展却不大」——再接「方向对但顺序要调整」这类万能转折
`.trim();
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
        `- 结构清晰，扫读能抓到可执行点\n` +
        `- 步骤、清单、对比、代码优先；概念点到为止\n` +
        `- 每个建议尽量可验证；技术文用接口/代码作证，非技术文用场景/数字作证`
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
  const engineering = isEngineeringTopic(input.topic, input.keywords);

  // 根据字数决定每个大纲的章节数
  const sectionCount =
    wordCount <= 1200 ? 3 :
    wordCount <= 2000 ? 4 :
    wordCount <= 3000 ? 5 :
    6;

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是一位资深公众号主编：既懂选题策划，也懂「读者为什么愿意读完」。请基于用户输入生成 ${count} 个**真正不同骨架**的大纲——不是同一篇文章换标题。

${buildDomainAdaptationBlock()}

${buildAccountPersonaBlock()}

${buildOnTopicBlock(input.topic, input.keywords)}

${buildQualityArticleBlock()}

${buildEvidenceBlock(engineering)}

${buildAntiAiVoiceBlock()}

${buildEngineeringOutlineBlock(engineering)}

【核心要求】
- 方案之间要有选题张力（选 A 还是选 B），禁止同一骨架换词
- 每个方案仍必须服务同一主题「${input.topic}」，差异在切入角与论证路径，不在换赛道
- 目标读者：${audience}，写作风格：${style}，文章目标：${input.goal?.trim() || "知识分享"}，目标字数：约 ${wordCount} 字
- 内容真实可信，不做夸大承诺

${buildStyleGuide(style)}

【标题要求】
- 每个 title ≤ 20 字，含主题关键词；自然口语或笔记感均可
- 禁止标题党、震惊体；少用「：从入门到精通」冒号模板
- **不要**硬套「悬念/数字/对比/场景/手册/态度」六种公式；${count} 个标题句式与切入点必须不同
- 实践向标题必须能对应后文干货（代码/步骤/案例），禁止空喊「实战手册」

【章节要求】
- 每个大纲约 ${sectionCount} 个章节；heading 避免「什么是XXX」「XXX的重要性」「总结与展望」
- 优先：具体问题、可验证动作、案例现场、对比取舍
- 各章 summary **不得重叠**：写清本章**新增的信息或交付物**（读者读完能带走什么），禁止「全面介绍」
- 至少一半章节的 summary 应暗示「有案例 / 有步骤 / 有代码或清单」中的一种（按领域选）
- positioning：15-30 字，说明适合谁、偏认知还是偏动手

【输出格式】
- **必须恰好返回 ${count} 个大纲**（outlines 数组长度 = ${count}），少一个都不合格；禁止只给 2～3 个就收工
- JSON：{ "outlines": [ { "title", "positioning", "sections": [ { "heading", "summary" } ] } ] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        ...buildWritingUserPayload({
          topic: input.topic,
          style,
          wordCount,
          audience,
          goal: input.goal,
          keywords: input.keywords,
          outlineCount: count,
          sectionsPerOutline: sectionCount,
        }),
        contentMode: engineering ? "engineering-hands-on" : "general",
        mustIncludeCodeInArticle: engineering,
        requiredOutlineCount: count,
      }),
    },
  ];

  // 6 套 × 多章节时 2048 很容易截断，模型会提前收工只吐 3 个
  const maxTokens = Math.min(8192, 1600 + count * sectionCount * 220);
  const raw = await callChat(prompt, { jsonMode: true, maxTokens, role: "outline" });
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

  return buildFallbackOutlines(input.topic, style, audience, wordCount, count, engineering);
}

function buildFallbackOutlines(
  topic: string,
  style: string,
  audience: string,
  wordCount: number,
  count: number = 3,
  engineering = false,
): OutlineOption[] {
  const sectionCount =
    wordCount <= 1200 ? 3 :
    wordCount <= 2000 ? 4 :
    wordCount <= 3000 ? 5 :
    6;

  if (engineering) {
    const engOptions: OutlineOption[] = [
      {
        index: 0,
        title: `从 Props 倒推：${topic}怎么封才好用`,
        positioning: `偏接口设计，适合准备封装组件的同学。`,
        sections: [
          { heading: "先定对外契约：value / onChange / 进度与取消", summary: "给出 Props/事件类型草案，明确受控与非受控。" },
          { heading: "内部状态机：idle → hashing → uploading → done", summary: "用状态枚举约束 UI 与请求时机。" },
          { heading: "最小上传通路：单文件直传先跑通", summary: "一段可运行的 fetch/XHR 示例，不含分片。" },
          { heading: "再加分片与并发池", summary: "队列 + 并发上限代码，说明为何不能无脑 Promise.all。" },
          { heading: "断点与失败重试的边界表", summary: "列出网络中断、419、blob 变更等用例与处理。" },
          { heading: "文档与示例：三行就能用的 README", summary: "最小用法与进阶配置对照。" },
        ].slice(0, sectionCount),
      },
      {
        index: 1,
        title: `${topic}：我被并发打挂浏览器之后`,
        positioning: `踩坑叙事 + 代码修正，适合有过上传翻车的读者。`,
        sections: [
          { heading: "翻车现场：同时拖 20 个大文件发生了什么", summary: "描述卡顿/内存/请求打满，对应现象。" },
          { heading: "根因：无界并发 + 重复读文件", summary: "指出错误实现片段。" },
          { heading: "修正：有界队列与切片复用", summary: "给出并发池与 chunk 读取代码。" },
          { heading: "进度与取消如何接到 UI", summary: "AbortController 与进度聚合示例。" },
          { heading: "回归清单：我后来每次发版必测这几条", summary: "可勾选的测试条目。" },
          { heading: "监控：成功率与 P95 耗时怎么埋", summary: "关键上报字段示例。" },
        ].slice(0, sectionCount),
      },
      {
        index: 2,
        title: `抄作业：一个能上生产的上传组件骨架`,
        positioning: `目录 + 关键文件代码，适合直接落地。`,
        sections: [
          { heading: "目录怎么拆：hooks / uploader / ui", summary: "给出推荐文件树。" },
          { heading: "createUploader：核心调度", summary: "调度器伪代码或 TS 实现。" },
          { heading: "useUpload：对接 React/Vue 的薄封装", summary: "hooks 示例。" },
          { heading: "服务端协议约定（etag / uploadId）", summary: "请求响应字段表 + 示例 JSON。" },
          { heading: "还能再抠的性能点", summary: "worker 算 hash、可见即可上传等，各给一行思路与取舍。" },
          { heading: "发布前检查清单", summary: "类型、 treeshake、peerDeps、changelog。" },
        ].slice(0, sectionCount),
      },
      {
        index: 3,
        title: `Vue 与 React 两套写法对照：${topic}`,
        positioning: `双框架对照，适合技术选型纠结期。`,
        sections: [
          { heading: "状态放哪：ref/reactive vs useReducer", summary: "给出两侧最小状态模型代码。" },
          { heading: "副作用与卸载：取消请求怎么写", summary: "onUnmounted / useEffect cleanup 对照。" },
          { heading: "可组合封装：composable 与 hook API", summary: "同一组方法签名在两套里的映射。" },
          { heading: "UI 扩展点：slot 与 render props", summary: "自定义进度条/列表项示例。" },
          { heading: "我怎么选：团队栈与复杂度决策树", summary: "一张简表帮读者选型。" },
          { heading: "迁移注意：从 Vue2/Options 过来的坑", summary: "常见误用与改法。" },
        ].slice(0, sectionCount),
      },
      {
        index: 4,
        title: `多媒体上传：图压缩、视频封面、音频波形`,
        positioning: `偏能力扩展，适合要做素材库的产品。`,
        sections: [
          { heading: "按 MIME 分流的处理管道", summary: "策略表 + 分发器代码。" },
          { heading: "图片：预览与 canvas 压缩参数", summary: "可运行压缩片段与体积对比思路。" },
          { heading: "视频：截帧封面与时长", summary: "video + canvas 示例与兼容性。" },
          { heading: "音频：简易波形绘制", summary: "Web Audio 关键路径。" },
          { heading: "主线程别堵死：Worker / idle 调度", summary: "何时搬进 Worker。" },
          { heading: "组件 API：能力开关怎么设计", summary: "Props 草案。" },
        ].slice(0, sectionCount),
      },
      {
        index: 5,
        title: `${topic}工程化：测试、弱网与发版`,
        positioning: `偏长期维护，适合组件负责人。`,
        sections: [
          { heading: "单测：并发池与进度计算", summary: "2～3 个用例骨架。" },
          { heading: "E2E：假文件与续传路径", summary: "Playwright/Cypress 要点。" },
          { heading: "弱网：online/offline 与自动暂停", summary: "事件监听示例。" },
          { heading: "内存：大文件读完要释放什么", summary: "ObjectURL / buffer 注意点。" },
          { heading: "版本与破坏性变更", summary: "semver 与 changelog 示例。" },
          { heading: "上线门禁清单", summary: "可打印的检查表。" },
        ].slice(0, sectionCount),
      },
    ];
    return engOptions.slice(0, count).map((opt, idx) => ({ ...opt, index: idx }));
  }

  const allOptions: OutlineOption[] = [
    {
      index: 0,
      title: `为什么你做不好${topic}？问题不在能力，在这三点`,
      positioning: `适合${audience}的${style}内容，约 ${wordCount} 字。`,
      sections: buildSections(topic, sectionCount, 0),
    },
    {
      index: 1,
      title: `把${topic}拆成可执行的三步（附检查标准）`,
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
      title: `我承认，以前对${topic}的理解太浅了`,
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
  const engineering = isEngineeringTopic(
    input.topic,
    input.keywords ?? input.outline?.title ?? null,
  );

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是一位写了 8 年公众号的资深主笔。读者评价你的文章「每段都有信息量，读完能动手或能想明白一件事」。请严格按大纲写——每章只写一次，禁止同义反复凑字。

${domainBlock}

${accountBlock}

${styleGuide}

${buildOnTopicBlock(input.topic, input.keywords)}

${buildQualityArticleBlock()}

${buildEvidenceBlock(engineering)}

${buildAntiAiVoiceBlock()}

${buildEngineeringContentBlock(engineering)}

${ARTICLE_HTML_FORMAT_RULES}

【标题要求】
- title ≤ 20 字，含核心关键词；不用震惊体；少用「：从入门到精通」
- 标题承诺与正文一致：写「实战/手册/步骤」就必须有对应干货（代码、步骤或案例）

【写作人格】
- 像写技术笔记/专栏：清楚、直接、有判断；第一人称可用，但不要扮演「懂行的朋友拉家常」
- 没把握时用「常见情况是」「我更倾向」，不要装权威

【开头要求】
- 禁止「在当今时代」「随着XX发展」「近年来」
- **禁止闲聊叙事开篇**：不要「和朋友/同事聊天」「他说最近在做XXX却进展不大」「我听完觉得方向对但顺序要调」这类套式
- 开篇 2-3 句直接进入主题：点明要解决的问题、核心结论，或一个与主题绑定的具体技术现象（报错、卡点、错误实现）
- 开头只负责立题，不要剧透后文每一章；必须仍在主题范围内
${engineering ? "- 工程文优先：第一段就落到接口/流程/卡点，不要情感铺垫" : ""}

【逻辑结构】
- 章节用 <h2>，章间 <hr />；全文最多 2 个 <h3>
- 每章一个新论点；步骤用 <ol>，并列用 <ul>；列表项 <li><strong>标题</strong>说明</li>
- 叙述以 <p> 为主；mp-tip / mp-warning / blockquote 全篇各 ≤ 2

【HTML 白名单】
- 允许：p/h2/h3/hr/strong/code/pre+code/blockquote/ul/ol/li、mp-tip/mp-warning/mp-summary
- 禁止：figure/img/section/table/自创 class、Markdown

【内容层次】
- 案例与判断全文分布即可，不要求每章机械凑齐「道理+案例+数据」
- 同一案例全文最多 1 次
- 实践章：先给可跟随的步骤/代码/清单，再补「为什么」
- 认知章：先钉住一个具体现象，再解释机制；理论不超过该章必要篇幅
${engineering ? "- 工程章：代码优先，解释为辅；理论段不超过该章篇幅的 40%" : ""}

【段落节奏】
- 长短句交替；每段 ≤ 4 句
- 用 <strong> 标关键判断（禁止 Markdown **）
- 不要段段「但真正的问题是…」

【反重复 / 反注水】
- 禁止同义词复读；禁止开头/正文/结尾讲同一故事三遍
- **禁止为凑字数注水**：目标约 ${wordCount} 字，允许 75%～110%；宁可偏短也不要空话
- 写完自检：删掉任何离开主题「${input.topic}」仍通顺的段落

【严禁】
- 夸夸其谈、绝对化、「赋能/抓手/闭环/底层逻辑/降维/颗粒度」
- 结尾引流关注点赞

【代码与术语】
- 术语、API、命令用 <code>
- 多行代码必须 <pre><code>...</code></pre>，前后 <hr />
${engineering ? "- 至少 2 个代码块；关键流程 ≥ 8 行；语言优先 TypeScript/JavaScript" : "- 主题涉及实现/操作时给代码或逐步操作；纯生活/科普可用案例与步骤代替代码，但不可空谈"}

【输出】
JSON：{ "title", "summary", "content" }
- summary：80-120 字，写清读者能带走什么
- content：完整 HTML（无 h1、无签名引流）
- 篇幅参考 ${wordCount} 字（去标签后），建议每章约 ${perSection} 字，**质量与切题优先于凑满字数**`,
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
        contentMode: engineering ? "engineering-hands-on" : "general",
        mustIncludeCodeBlocks: engineering ? 2 : 0,
        writingRequirements: {
          targetWordCount: wordCount,
          softMinimumWordCount: Math.floor(wordCount * 0.75),
          suggestedWordsPerSection: perSection,
          sectionCount: sections.length,
          preferDensityOverPadding: true,
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
    const minWords = Math.floor(wordCount * 0.75);
    if (plainChars < minWords) {
      console.warn(
        `[generateContent] 正文字数 ${plainChars} 低于参考目标 ${wordCount}（软下限 ${minWords}），maxTokens=${maxTokens}`,
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
      <p>做<strong>${input.topic}</strong>时，最常见的问题不是不会写代码，而是模块边界和落地顺序一开始就糊了：先堆功能，再补分片、进度、续传，最后很难收成可复用组件。</p>
      <p>下面按可落地的顺序拆：先定对外契约，再补内部调度与边界，尽量少返工。</p>
      ${fallbackSections}
      <hr />
      <section>
        <h2>总结</h2>
        <div class="mp-summary">
          <p>关于${input.topic}，优先把对外 API、状态机和一条最小上传通路跑通，再叠加分片、并发与续传；顺序反了，后面全是补丁。</p>
          <p>今天就选一个卡点改：接口、队列或进度，先改清楚一处，再扩到下一处。</p>
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
