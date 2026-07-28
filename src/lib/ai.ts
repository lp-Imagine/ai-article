import type { OutlineOption } from "@/types/article";
import { getEnvValue } from "@/lib/config-bridge";
import { highlightCodeBlocks } from "@/lib/code-highlight";
import { normalizeCalloutBlocks } from "@/lib/wechat-style";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { analyzeContentQuality } from "@/lib/content-quality";
import { isTransientNetworkError, withRetry } from "@/lib/retry";

type TextRole =
  | "outline"
  | "content"
  | "summary"
  | "titles"
  | "cover-prompt"
  | "polish"
  | "expand"
  | "section-image"
  | "reformat"
  | "refine";

const PRIMARY_TEXT_ROLES = new Set<TextRole>([
  "outline",
  "content",
  "polish",
  "expand",
  "reformat",
  "refine",
]);

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

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

const isTransientLlmError = isTransientNetworkError;

function normalizeLlmError(error: unknown, role: TextRole, timeoutMs: number): Error {
  if (!(error instanceof Error)) return new Error("LLM 请求失败");
  if (error.name === "AbortError") {
    const hint =
      role === "outline"
        ? "大纲一般应在数分钟内返回。"
        : role === "reformat"
          ? "整理格式需整篇重排，长文可能需数分钟，请稍后重试。"
          : "请检查模型服务/网络后重试。";
    return new Error(`LLM 请求超时（${Math.round(timeoutMs / 1000)} 秒）。${hint}`);
  }
  if (/fetch failed/i.test(error.message)) {
    const cause =
      error.cause instanceof Error
        ? error.cause.message
        : typeof error.cause === "string"
          ? error.cause
          : "";
    return new Error(
      cause
        ? `LLM 连接失败（fetch failed: ${cause}）。请检查模型服务/网络后重试。`
        : "LLM 连接失败（fetch failed）。请检查模型服务/网络后重试；长文已改为分段生成。",
    );
  }
  if (/^terminated$/i.test(error.message.trim()) || /terminated/i.test(error.message)) {
    return new Error(
      "LLM 连接被上游中断（terminated）。常见于代理/网关约 60 秒超时；系统已改用按章节分段生成，请重试。",
    );
  }
  return error;
}

/** 在途请求数，用于判断上游是否被并发拖慢 */
let llmInFlight = 0;

async function callChat(
  messages: ChatMessage[],
  opts?: {
    jsonMode?: boolean;
    maxTokens?: number;
    role?: TextRole;
    temperature?: number;
    /** 调用方自带重试循环时传 1，避免与内层重试相乘 */
    retries?: number;
  },
) {
  const jsonMode = opts?.jsonMode ?? true;
  const maxTokens = opts?.maxTokens ?? 2048;
  const role = opts?.role ?? "content";
  const temperature = opts?.temperature ?? (role === "reformat" ? 0.2 : 0.7);

  const { model, baseUrl, apiKey } = getLLMConfig(role);
  if (!apiKey) {
    return null;
  }

  const timeoutMs = getLlmTimeoutMs(role);
  const maxAttempts = opts?.retries ?? (role === "content" || role === "refine" ? 3 : 2);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    llmInFlight += 1;
    const inFlightAtStart = llmInFlight;

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
          temperature,
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
        usage?: { completion_tokens?: number };
      };

      const seconds = (Date.now() - startedAt) / 1000;
      const outTokens = json.usage?.completion_tokens ?? 0;
      console.log(
        `[llm] role=${role} ${seconds.toFixed(1)}s inflight=${inFlightAtStart} ` +
          `out=${outTokens}tok${outTokens ? ` ${(outTokens / seconds).toFixed(1)}tok/s` : ""} cap=${maxTokens}`,
      );

      return json.choices[0]?.message?.content ?? "";
    } catch (error) {
      const normalized = normalizeLlmError(error, role, timeoutMs);
      console.warn(
        `[llm] role=${role} FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s ` +
          `inflight=${inFlightAtStart}: ${normalized.message.slice(0, 120)}`,
      );
      lastError = normalized;
      if (attempt < maxAttempts - 1 && isTransientLlmError(normalized)) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      throw normalized;
    } finally {
      llmInFlight -= 1;
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("LLM 请求失败");
}

function getLlmTimeoutMs(role: TextRole): number {
  const raw = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  // 工程长主题 + 多套大纲时，模型常需 2～5 分钟；超时过紧会误杀
  // reformat 与 polish 同量级：整篇 HTML 输出，不能用短任务超时
  if (
    role === "content" ||
    role === "polish" ||
    role === "expand" ||
    role === "reformat" ||
    role === "refine"
  ) {
    return 480_000; // 8 分钟
  }
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
7. **创作度**：切入角、案例选择、判断要像「为本题现写」，不要像批量模板填空

禁止的空洞写法：
- 只抛概念不下定义也不举例
- 「本质上是认知问题」「关键在于体系化」却不说具体改哪一步
- 排比正确废话、假装深刻的对立（旧时代 vs 新时代）却无事实
- 用「和朋友聊天 / 有人问我 / 上周同事说」这类虚构闲聊当万能开头
- 段段正确但无法下手的「建议」（要重视、要体系化、要持续迭代）
`.trim();
}

/** 对齐微信对低创作度 / 低质 AIGC 的治理口径 */
function buildWechatPlatformValueBlock(): string {
  return `
【微信公众号内容价值（硬性，平台合规）】
平台会限流「低创作度」内容：高度同质化、搬运抄袭、内容空洞、低质 AIGC。
你必须写出「信息含量高、有阅读价值、有创作度」的稿：

1. **信息增量**：每段至少贡献一件新信息（事实、步骤、判断依据、边界、反例）；删掉后读者应少懂一件事
2. **创作度**：独特切入角 + 可核对判断；禁用「定义→重要性→方法论→注意事项→总结」百科骨架
3. **可核对**：优先可观察细节（场景、数字、报错原文、前后对比）；不写无法证伪的正确废话
4. **反同质化**：开篇、章节顺序、案例选择要服务「这一篇主题」，禁止万能模板换词
5. **反空洞 AIGC**：禁止排比鸡汤、无主体的「我们需要…」、段段正确但无用的建议
6. **诚实**：不确定就标明；不编造数据、论文、权威背书或虚假对话

段落自检（任一项为否 → 重写该段）：
- 读者读完能否多知道/会做一件具体事？
- 把主题换成别的标题，这段是否还通顺？（通顺=空泛）
- 是否像随处可见的 AI 水文？（是 → 换成案例/步骤/代码）
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
- 禁止套话：在当今/随着…发展/赋能/抓手/闭环/底层逻辑/降维/颗粒度/对齐/沉淀方法论/打造闭环/深度思考/认知升级/众所周知/毋庸置疑/值得注意的是
- 禁止每个大纲都长成：痛点引入 → 三大误解 → 三步方法论 → 注意事项 → 总结（换词不算创新）
- 标题禁止批量套用同一公式；「XXX实战手册」最多在全部方案里出现 1 次，且该方案必须可落地
- 少用抽象形容词（赋能、卓越、全面、系统性）；改用可观察事实
- 允许不完美与取舍：真实感强于完美教条
- **禁止「闲聊代入」开篇模板**：如「周一/上周和一个朋友聊天」「同事问我」「有读者留言说最近在XXX上花了很多时间，进展却不大」——再接「方向对但顺序要调整」这类万能转折
- 禁止段首机械排比（「首先要明白」「其次需要注意」「最后别忘了」连用）；节奏要像人写的笔记
- 同一句式开头不得连续出现 3 次以上
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

/** 拆分并发生成时，为每套方案指定不同切入角，替代「同一次调用里互相错开」 */
const OUTLINE_ANGLES = [
  "问题现场切入：从一个具体的翻车/卡住场景开始，再一步步给出正解",
  "对比选型：在 2-3 个可选做法之间做取舍，给出判断标准与适用边界",
  "最小可用切片：从零搭一个能跑起来的最小版本，再逐步加码",
  "清单式手册：给可直接照做的步骤清单、参数与踩坑边界",
  "认知纠偏：先钉住一个常见误解，用事实和例子逐条拆解",
  "复盘式：按时间线讲一次完整实践，突出关键决策点与代价",
];

function getOutlineConcurrency(count: number): number {
  const raw = Number(process.env.OUTLINE_CONCURRENCY ?? "");
  const configured = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
  return Math.max(1, Math.min(configured, count));
}

function normalizeOutlineOption(
  opt: OutlineOption,
  idx: number,
  topic: string,
  style: string,
  wordCount: number,
): OutlineOption {
  return {
    index: idx,
    title: opt.title ?? `${topic}：方案 ${idx + 1}`,
    positioning: opt.positioning ?? `${style}向，约 ${wordCount} 字。`,
    sections: (opt.sections ?? []).map((s) => ({
      heading: s.heading ?? "未命名章节",
      summary: s.summary ?? "",
    })),
  };
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

  // 一次吐 N 套 × 多章节的长响应最容易被上游 ~60s 网关掐断，默认拆成每套一个请求并发
  if ((process.env.OUTLINE_GENERATION_MODE ?? "parallel") !== "monolithic") {
    const parallel = await generateOutlinesInParallel({
      ...input,
      style,
      audience,
      wordCount,
      count,
      sectionCount,
      engineering,
    });
    if (parallel.length > 0) return parallel;
    return buildFallbackOutlines(input.topic, style, audience, wordCount, count, engineering);
  }

  const prompt = buildOutlinePrompt({
    ...input,
    style,
    audience,
    wordCount,
    count,
    sectionCount,
    engineering,
    angle: null,
  });

  const maxTokens = Math.min(8192, 1600 + count * sectionCount * 220);
  const raw = await callChat(prompt, { jsonMode: true, maxTokens, role: "outline" });
  const parsed = safeParse<{ outlines?: OutlineOption[] }>(raw, {});

  if (parsed.outlines && parsed.outlines.length > 0) {
    return parsed.outlines
      .slice(0, count)
      .map((opt, idx) => normalizeOutlineOption(opt, idx, input.topic, style, wordCount));
  }

  return buildFallbackOutlines(input.topic, style, audience, wordCount, count, engineering);
}

type OutlinePromptInput = {
  topic: string;
  style: string;
  audience: string;
  wordCount: number;
  goal?: string | null;
  keywords?: string | null;
  count: number;
  sectionCount: number;
  engineering: boolean;
  /** 非空时表示本次只生成一套方案，并锁定该切入角 */
  angle: string | null;
};

function buildOutlinePrompt(input: OutlinePromptInput): ChatMessage[] {
  const { topic, style, audience, wordCount, count, sectionCount, engineering, angle } = input;
  const single = angle !== null;

  return [
    {
      role: "system",
      content: `你是一位资深公众号主编：既懂选题策划，也懂「读者为什么愿意读完」。${
        single
          ? `请基于用户输入生成 **1 个**大纲，并严格采用指定切入角。`
          : `请基于用户输入生成 ${count} 个**真正不同骨架**的大纲——不是同一篇文章换标题。`
      }

${buildDomainAdaptationBlock()}

${buildAccountPersonaBlock()}

${buildOnTopicBlock(input.topic, input.keywords)}

${buildQualityArticleBlock()}

${buildWechatPlatformValueBlock()}

${buildEvidenceBlock(engineering)}

${buildAntiAiVoiceBlock()}

${buildEngineeringOutlineBlock(engineering)}

【核心要求】
${
  single
    ? `- **本方案必须采用这个切入角**：${angle}\n- 切入角决定骨架：标题、章节顺序都要体现它，不要写成通用百科目录`
    : `- 方案之间要有选题张力（选 A 还是选 B），禁止同一骨架换词`
}
- 必须服务同一主题「${topic}」，差异在切入角与论证路径，不在换赛道
- 目标读者：${audience}，写作风格：${style}，文章目标：${input.goal?.trim() || "知识分享"}，目标字数：约 ${wordCount} 字
- 内容真实可信，不做夸大承诺；宁可信息密度高略短，也不做空洞长文
- positioning 要写清「这篇独特价值是什么」（读者为什么读这篇而不是百科）

${buildStyleGuide(style)}

【标题要求】
- title ≤ 20 字，含主题关键词；自然口语或笔记感均可
- 禁止标题党、震惊体；少用「：从入门到精通」冒号模板
- **不要**硬套「悬念/数字/对比/场景/手册/态度」六种公式${single ? "" : `；${count} 个标题句式与切入点必须不同`}
- 实践向标题必须能对应后文干货（代码/步骤/案例），禁止空喊「实战手册」

【章节要求】
- 每个大纲约 ${sectionCount} 个章节；heading 避免「什么是XXX」「XXX的重要性」「总结与展望」
- 优先：具体问题、可验证动作、案例现场、对比取舍
- 各章 summary **不得重叠**：写清本章**新增的信息或交付物**（读者读完能带走什么），禁止「全面介绍」
- 至少一半章节的 summary 应暗示「有案例 / 有步骤 / 有代码或清单」中的一种（按领域选）
- positioning：15-30 字，说明适合谁、偏认知还是偏动手

【输出格式】
${
  single
    ? "- outlines 数组长度必须为 1"
    : `- **必须恰好返回 ${count} 个大纲**（outlines 数组长度 = ${count}），少一个都不合格；禁止只给 2～3 个就收工`
}
- JSON：{ "outlines": [ { "title", "positioning", "sections": [ { "heading", "summary" } ] } ] }`,
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
        ...(single ? { requiredAngle: angle } : {}),
      }),
    },
  ];
}

/** 每套方案一个短请求并发生成：单次响应更小，几乎不会撞上网关超时 */
async function generateOutlinesInParallel(
  input: Omit<OutlinePromptInput, "angle">,
): Promise<OutlineOption[]> {
  const { topic, style, audience, wordCount, count, sectionCount } = input;
  const maxTokens = Math.min(4096, 1200 + sectionCount * 260);

  const results = await mapWithConcurrency(
    Array.from({ length: count }, (_, i) => i),
    getOutlineConcurrency(count),
    async (i) => {
      try {
        const raw = await callChat(
          buildOutlinePrompt({ ...input, angle: OUTLINE_ANGLES[i % OUTLINE_ANGLES.length] }),
          { jsonMode: true, maxTokens, role: "outline" },
        );
        const parsed = safeParse<{ outlines?: OutlineOption[] }>(raw, {});
        const first = parsed.outlines?.[0];
        return first && (first.sections?.length ?? 0) > 0 ? first : null;
      } catch (error) {
        console.error(
          `[generateOutline] scheme ${i + 1}/${count} failed:`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },
  );

  return results
    .filter((opt): opt is OutlineOption => opt !== null)
    .map((opt, idx) => normalizeOutlineOption(opt, idx, topic, style, wordCount));
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

export type ContentProgressCallback = (
  stepLabel: string,
  stepIndex: number,
  stepTotal: number,
) => void | Promise<void>;

function buildContentSystemPromptCore(input: {
  topic: string;
  style: string;
  wordCount: number;
  perSection: number;
  engineering: boolean;
  keywords?: string | null;
  accountBlock: string;
  domainBlock: string;
  styleGuide: string;
  sectional?: boolean;
}): string {
  const { topic, style, wordCount, perSection, engineering, accountBlock, domainBlock, styleGuide, sectional } =
    input;
  return `你是一位写了 8 年公众号的资深主笔。读者评价你的文章「每段都有信息量，读完能动手或能想明白一件事」。${sectional ? "本次只写指定片段，不要写其他章节。" : "请严格按大纲写——每章只写一次，禁止同义反复凑字。"}

${domainBlock}

${accountBlock}

${styleGuide}

${buildOnTopicBlock(topic, input.keywords)}

${buildQualityArticleBlock()}

${buildWechatPlatformValueBlock()}

${buildEvidenceBlock(engineering)}

${buildAntiAiVoiceBlock()}

${buildEngineeringContentBlock(engineering)}

${ARTICLE_HTML_FORMAT_RULES_BRIEF}

【写作人格】清楚、直接、有判断；没把握时用「常见情况是」，不要装权威。
【开头】禁止闲聊叙事开篇；${engineering ? "工程文先落到接口/流程/卡点。" : ""}
【结构】章节用 <h2>，章间 <hr />；列表项 <li><strong>标题</strong>说明</li>
【反注水】目标约 ${wordCount} 字全文${sectional ? `，本章约 ${perSection} 字` : ""}；宁可偏短也不要空话
【严禁】赋能/抓手/闭环/认知升级/编造数据/结尾引流`;
}

function finalizeGeneratedContent(
  content: string,
  fallbackTitle: string,
  fallbackSummary: string,
): { title: string; summary: string; content: string; missingSections: string[] } {
  const safeContent = content
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/g, "")
    .replace(/<div class="mp-signature">[\s\S]*?<\/div>/g, "");
  const fixedContent = dedupeRepeatedBlocks(fixCodeBlocks(normalizeCalloutBlocks(safeContent)));
  const highlightedContent = highlightCodeBlocks(fixedContent);
  return {
    title: fallbackTitle,
    summary: fallbackSummary,
    content: highlightedContent,
    missingSections: [],
  };
}

function extractHtmlFromLlmJson(
  parsed: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const val = parsed[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return "";
}

/** 从模型的非 JSON 回复里取出正文 HTML（去掉 markdown 代码围栏与前后解释） */
function extractHtmlFromPlainReply(raw: string): string {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const firstTag = body.search(/<(h2|p|ul|ol|pre|blockquote|div)\b/i);
  return firstTag > 0 ? body.slice(firstTag).trim() : body;
}

const SECTION_ATTEMPTS = 3;

async function generateContentSectionHtml(input: {
  systemCore: string;
  topic: string;
  title: string;
  style: string;
  section: { heading: string; summary: string };
  sectionIndex: number;
  sectionTotal: number;
  previousHeadings: string[];
  perSection: number;
  engineering: boolean;
  isLastSummary: boolean;
}): Promise<string> {
  const { section } = input;
  const maxTokens = Math.min(
    4096,
    Math.max(2048, Math.ceil(input.perSection * 2.4) + 600),
  );
  let lastError = "模型未返回有效内容";

  for (let attempt = 0; attempt < SECTION_ATTEMPTS; attempt++) {
    // 最后一次改用纯 HTML 输出：JSON 模式偶发返回空字段/截断
    const plainMode = attempt === SECTION_ATTEMPTS - 1;

    try {
      const sectionRaw = await callChat(
        [
          {
            role: "system",
            content: `${input.systemCore}

【本次任务：单章正文】
${
  plainMode
    ? "直接输出本章 HTML 片段，不要 JSON、不要 markdown 围栏、不要任何解释文字"
    : '输出 JSON：{ "sectionHtml": string }\n- **必须**返回非空 sectionHtml 字段（不要用 content/html 等其它键名）'
}
- 只写本章：${section.heading}
- 必须以 <h2>${section.heading}</h2> 开头
- 本章目标：${section.summary}
- 本章约 ${input.perSection} 字（去标签）；禁止重复其他章节内容
${input.isLastSummary ? '- 最后一章可用 <div class="mp-summary"><p>...</p></div>' : ""}`,
          },
          {
            role: "user",
            content: JSON.stringify({
              topic: input.topic,
              title: input.title,
              style: input.style,
              sectionIndex: input.sectionIndex,
              sectionTotal: input.sectionTotal,
              section,
              previousHeadings: input.previousHeadings,
              suggestedWords: input.perSection,
              engineering: input.engineering,
            }),
          },
        ],
        // 本函数自带 3 次尝试，内层不再重试，否则最坏会变成 9 次串起来的长等待
        { jsonMode: !plainMode, maxTokens, role: "content", temperature: 0.65, retries: 1 },
      );

      if (!sectionRaw) {
        lastError = "模型未返回内容（请检查 API Key）";
      } else {
        const html = plainMode
          ? extractHtmlFromPlainReply(sectionRaw)
          : extractHtmlFromLlmJson(safeParse<Record<string, unknown>>(sectionRaw, {}), [
              "sectionHtml",
              "content",
              "html",
              "section",
            ]);

        if (html.length >= 60) return html;

        lastError = `输出过短或字段缺失（${html.length} 字）`;
        console.warn(
          `[generateContentBySections] section ${input.sectionIndex} attempt ${attempt + 1} short output`,
          sectionRaw.slice(0, 200),
        );
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "章节生成失败";
      if (!isTransientLlmError(error) && attempt < SECTION_ATTEMPTS - 1) {
        // 非网络类错误（如鉴权、配额）重试无意义
        throw error;
      }
      if (attempt === SECTION_ATTEMPTS - 1) throw error;
    }

    await sleep(800 * (attempt + 1));
  }

  throw new Error(`章节「${section.heading}」生成失败：${lastError}`);
}

function getSectionConcurrency(sectionCount: number): number {
  const raw = Number(process.env.CONTENT_SECTION_CONCURRENCY ?? "");
  const configured = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
  return Math.max(1, Math.min(configured, sectionCount));
}

async function generateContentBySections(
  input: {
    topic: string;
    outline: OutlineOption;
    style?: string | null;
    wordCount?: number | null;
    audience?: string | null;
    goal?: string | null;
    keywords?: string | null;
  },
  onProgress?: ContentProgressCallback,
) {
  const style = input.style || "干货型";
  const wordCount = input.wordCount ?? 1200;
  const sections = input.outline.sections ?? [];
  const perSection = Math.max(280, Math.floor(wordCount / Math.max(sections.length, 1)));
  const engineering = isEngineeringTopic(input.topic, input.keywords ?? input.outline.title ?? null);
  const accountBlock = buildAccountPersonaBlock();
  const domainBlock = buildDomainAdaptationBlock();
  const styleGuide = buildStyleGuide(style);
  const systemCore = buildContentSystemPromptCore({
    topic: input.topic,
    style,
    wordCount,
    perSection,
    engineering,
    keywords: input.keywords,
    accountBlock,
    domainBlock,
    styleGuide,
    sectional: true,
  });

  const totalSteps = 1 + sections.length;
  let step = 0;
  const report = async (label: string) => {
    await onProgress?.(label, step, totalSteps);
    step += 1;
  };

  await report("生成标题与开篇（0/" + sections.length + " 章）");
  const metaRaw = await callChat(
    [
      {
        role: "system",
        content: `${systemCore}

【本次任务：标题 + 摘要 + 开篇】
输出 JSON：{ "title": string, "summary": string, "openingHtml": string }
- title ≤ 20 字；summary 80-120 字
- openingHtml：开篇 2-4 段 <p>（直接点题），**不要** <h2>，不要写正文章节`,
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
          task: "meta",
        }),
      },
    ],
    { jsonMode: true, maxTokens: 1200, role: "content", temperature: 0.65 },
  );
  const meta = safeParse<Record<string, unknown>>(metaRaw, {});
  const title =
    (typeof meta.title === "string" && meta.title) ||
    input.outline.title ||
    input.topic;
  const summary =
    (typeof meta.summary === "string" && meta.summary) ||
    `围绕「${input.topic}」的一篇${style}稿，读完能带走可执行要点。`;
  const openingHtml =
    extractHtmlFromLlmJson(meta, ["openingHtml", "opening", "content"]) || "";

  // 各章互不依赖（上下文只用大纲标题），并发生成把串行的 N×30s 压成 N/并发数
  const allHeadings = sections.map((s) => s.heading);
  let doneCount = 0;
  const failedHeadings: string[] = [];

  const sectionParts = await mapWithConcurrency(
    sections,
    getSectionConcurrency(sections.length),
    async (section, i) => {
      try {
        return await generateContentSectionHtml({
          systemCore,
          topic: input.topic,
          title,
          style,
          section,
          sectionIndex: i + 1,
          sectionTotal: sections.length,
          previousHeadings: allHeadings.filter((_, idx) => idx !== i),
          perSection,
          engineering,
          isLastSummary:
            i === sections.length - 1 && /总结|收尾|带走/.test(section.heading),
        });
      } catch (error) {
        console.error(
          `[generateContentBySections] section ${i + 1} failed:`,
          error instanceof Error ? error.message : error,
        );
        failedHeadings.push(section.heading);
        return "";
      } finally {
        doneCount += 1;
        await report(`生成章节 ${doneCount}/${sections.length}`);
      }
    },
  );

  // 少量章节失败时保留其余成果，避免整篇几分钟的生成被一章拖垮
  if (failedHeadings.length > 0 && failedHeadings.length * 2 >= sections.length) {
    throw new Error(
      `正文生成失败：${failedHeadings.length}/${sections.length} 个章节未生成成功，请重试`,
    );
  }

  const content = [openingHtml, ...sectionParts].filter(Boolean).join("\n<hr />\n");
  if (countPlainTextChars(content) < 200) {
    throw new Error("正文生成失败：分段合并后内容过短，请重试");
  }

  return {
    ...finalizeGeneratedContent(content, title, summary),
    missingSections: failedHeadings,
  };
}

export async function generateContent(
  input: {
    topic: string;
    outline?: OutlineOption | null;
    style?: string | null;
    wordCount?: number | null;
    audience?: string | null;
    goal?: string | null;
    keywords?: string | null;
  },
  opts?: { onProgress?: ContentProgressCallback },
) {
  const sections = input.outline?.sections ?? buildSections(input.topic);
  const wordCount = input.wordCount ?? 1200;
  const perSection = Math.max(280, Math.floor(wordCount / Math.max(sections.length, 1)));

  // 整篇一次生成易被上游 ~60s 网关掐断（terminated）；有大纲时默认按章分段
  const preferSectional =
    Boolean(input.outline?.sections?.length) &&
    (process.env.CONTENT_GENERATION_MODE ?? "sectional") !== "monolithic";
  if (preferSectional && input.outline) {
    return generateContentBySections(
      {
        topic: input.topic,
        outline: input.outline,
        style: input.style,
        wordCount: input.wordCount,
        audience: input.audience,
        goal: input.goal,
        keywords: input.keywords,
      },
      opts?.onProgress,
    );
  }

  const style = input.style || "干货型";
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

${buildWechatPlatformValueBlock()}

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
- 允许写取舍与做不到的部分——这比完美教条更有创作度

【开头要求】
- 禁止「在当今时代」「随着XX发展」「近年来」「众所周知」
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

【反重复 / 反注水 / 反低质 AIGC】
- 禁止同义词复读；禁止开头/正文/结尾讲同一故事三遍
- **禁止为凑字数注水**：目标约 ${wordCount} 字，允许 75%～110%；宁可偏短也不要空话
- 写完自检：删掉任何离开主题「${input.topic}」仍通顺的段落
- 写完再自检：若整段换成其他主题标题仍成立，必须重写为带细节的段落

【严禁】
- 夸夸其谈、绝对化、「赋能/抓手/闭环/底层逻辑/降维/颗粒度/认知升级」
- 结尾引流关注点赞
- 编造对话、数据、论文或「某大厂内部」传闻

【代码与术语】
- 术语、API、命令用 <code>
- 多行代码必须 <pre><code>...</code></pre>，前后 <hr />
${engineering ? "- 至少 2 个代码块；关键流程 ≥ 8 行；语言优先 TypeScript/JavaScript" : "- 主题涉及实现/操作时给代码或逐步操作；纯生活/科普可用案例与步骤代替代码，但不可空谈"}

【输出】
JSON：{ "title", "summary", "content" }
- summary：80-120 字，写清读者能带走什么（一个动作/判断标准/清单）
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
        platformCompliance: "wechat-high-value-anti-low-aigc",
        writingRequirements: {
          targetWordCount: wordCount,
          softMinimumWordCount: Math.floor(wordCount * 0.75),
          suggestedWordsPerSection: perSection,
          sectionCount: sections.length,
          preferDensityOverPadding: true,
          requireInformationGainPerParagraph: true,
        },
      }),
    },
  ];

  const maxTokens = computeContentMaxTokens(wordCount);
  const raw = await callChat(prompt, {
    jsonMode: true,
    maxTokens,
    role: "content",
    temperature: 0.65,
  });
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
    return finalizeGeneratedContent(
      fixedContent,
      parsed.title ?? input.outline?.title ?? input.topic,
      parsed.summary ?? `围绕"${input.topic}"生成的一篇${style}公众号草稿。`,
    );
  }

  // 不再用注水模板凑稿（低质 AIGC）；让任务失败以便重试
  if (!isAiConfigured()) {
    throw new Error("正文生成失败：未配置 AI_API_KEY，请先在设置中配置模型");
  }
  throw new Error(
    "正文生成失败：模型返回内容过短或无效。请换模型/重试，或检查大纲是否过于空泛",
  );
}

/** 按 <h2> 切成可独立精炼的片段（片段 0 为开篇） */
export function splitContentIntoRefineBlocks(html: string): string[] {
  const positions: number[] = [];
  const h2 = /<h2\b/gi;
  let match: RegExpExecArray | null;
  while ((match = h2.exec(html)) !== null) positions.push(match.index);
  if (positions.length === 0) return [html];

  const blocks: string[] = [];
  const opening = html.slice(0, positions[0]).trim();
  if (opening) blocks.push(opening);
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1] : html.length;
    const block = html.slice(positions[i], end).trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

/** 章节间的 <hr /> 分隔符由代码维护，避免模型改写片段时丢失 */
const TRAILING_HR = /(?:\s*<hr\s*\/?>)+\s*$/i;

/**
 * 把整篇 HTML 按 <h2> 拆块并发处理再合并。
 * 单块失败由 fn 自行回退原文；整体缩水过多时由调用方决定是否放弃。
 */
async function processHtmlBlocksInParallel(
  content: string,
  fn: (blockHtml: string, index: number) => Promise<{ content: string; changed: boolean }>,
): Promise<{ merged: string; changed: boolean; blockCount: number }> {
  const blocks = splitContentIntoRefineBlocks(content);

  const results = await mapWithConcurrency(
    blocks,
    getSectionConcurrency(blocks.length),
    async (block, i) => {
      const hadTrailingHr = TRAILING_HR.test(block);
      const result = await fn(block.replace(TRAILING_HR, ""), i);
      return {
        ...result,
        content: hadTrailingHr
          ? `${result.content.replace(TRAILING_HR, "")}\n<hr />`
          : result.content,
      };
    },
  );

  return {
    merged: results.map((r) => r.content).join("\n"),
    changed: results.some((r) => r.changed),
    blockCount: blocks.length,
  };
}

function getRefineMinScore(): number {
  const raw = Number(process.env.CONTENT_REFINE_MIN_SCORE ?? "");
  return Number.isFinite(raw) ? raw : 78;
}

function buildRefineSystemPrompt(topic: string, scope: "whole" | "block"): string {
  return `你是公众号终审编辑，专治「低创作度 / 空洞 / 低质 AIGC」。把用户稿件精炼成信息密度更高、更有阅读价值的版本。

${ARTICLE_HTML_FORMAT_RULES_BRIEF}

${buildWechatPlatformValueBlock()}

${buildAntiAiVoiceBlock()}

【精炼动作（必须执行）】
1. 删除套话、正确废话、同义反复；合并重复段落
2. 空泛判断 → 改成具体场景 / 步骤 / 对比 / 代码或边界条件（不编造精确数据）
3. 开篇若是闲聊模板，改成直接点题
4. 保留原有 HTML 结构与代码块；可微调 <strong> 标注关键判断
5. 保持主题「${topic}」与标题承诺；不改成另一篇文章
6. 字数允许略减（到原文的 85%～105%），**宁短勿水**
7. 结尾只留可带走动作/清单/判断标准，不要口号升华

【输出】
${
  scope === "whole"
    ? 'JSON：{ "content": string, "summary"?: string }\n- content：精炼后的完整 HTML\n- summary：可选，80-120 字，若原摘要空泛则重写'
    : 'JSON：{ "content": string }\n- content：只返回本片段精炼后的 HTML，保留原有 <h2> 标题文字\n- 不要补写其他章节，不要加导语或过渡到下一章的句子'
}`;
}

/** 单块精炼；任何异常/异常输出都回退原文 */
async function refineHtmlBlock(input: {
  topic: string;
  title?: string | null;
  style?: string | null;
  html: string;
  wantSummary: boolean;
  summary?: string | null;
}): Promise<{ content: string; summary?: string; refined: boolean }> {
  const plainLen = countPlainTextChars(input.html);
  const maxTokens = Math.min(8192, Math.max(1024, Math.ceil(plainLen * 2.2) + 600));

  try {
    const raw = await callChat(
      [
        {
          role: "system",
          content: buildRefineSystemPrompt(input.topic, input.wantSummary ? "whole" : "block"),
        },
        {
          role: "user",
          content: JSON.stringify({
            topic: input.topic,
            title: input.title ?? "",
            style: input.style || "干货型",
            ...(input.wantSummary ? { summary: input.summary ?? "" } : {}),
            content: input.html,
            goal: "raise-information-density-and-originality",
          }),
        },
      ],
      { jsonMode: true, maxTokens, role: "refine", temperature: 0.35 },
    );

    const parsed = safeParse<{ content?: string; summary?: string }>(raw, {});
    const refinedPlain = parsed.content ? countPlainTextChars(parsed.content) : 0;
    // 防模型把片段砍成残稿
    if (!parsed.content || refinedPlain < plainLen * 0.55) {
      return { content: input.html, refined: false };
    }
    return {
      content: parsed.content,
      summary: parsed.summary?.trim() || undefined,
      refined: true,
    };
  } catch (error) {
    console.error("[refineContentQuality] block failed:", error);
    return { content: input.html, refined: false };
  }
}

/**
 * 生成后精炼：提高信息密度、去套话、强化创作度（微信反低质 AIGC）
 * 质量启发式已达标时直接跳过；否则按 <h2> 分块并行精炼。
 * 失败时返回原文，不阻断主流程。
 */
export async function refineContentQuality(input: {
  topic: string;
  title?: string | null;
  summary?: string | null;
  content: string;
  style?: string | null;
}): Promise<{ content: string; summary?: string; refined: boolean; skipped?: boolean }> {
  if (!isAiConfigured()) {
    return { content: input.content, refined: false };
  }
  const plainLen = countPlainTextChars(input.content);
  if (plainLen < 400) {
    return { content: input.content, refined: false };
  }

  // 初稿已达标就不再花一轮整篇改写的时间
  const preCheck = analyzeContentQuality({
    title: input.title,
    summary: input.summary,
    content: input.content,
  });
  if (preCheck.score >= getRefineMinScore()) {
    return { content: input.content, refined: false, skipped: true };
  }

  const blocks = splitContentIntoRefineBlocks(input.content);
  const normalize = (html: string) =>
    highlightCodeBlocks(dedupeRepeatedBlocks(fixCodeBlocks(normalizeCalloutBlocks(html))));

  if (blocks.length < 2) {
    const single = await refineHtmlBlock({
      topic: input.topic,
      title: input.title,
      style: input.style,
      html: input.content,
      wantSummary: true,
      summary: input.summary,
    });
    return single.refined
      ? { ...single, content: normalize(single.content) }
      : { content: input.content, refined: false };
  }

  let newSummary: string | undefined;
  const { merged, changed } = await processHtmlBlocksInParallel(input.content, async (html, i) => {
    const result = await refineHtmlBlock({
      topic: input.topic,
      title: input.title,
      style: input.style,
      html,
      wantSummary: i === 0,
      summary: input.summary,
    });
    if (i === 0 && result.summary) newSummary = result.summary;
    return { content: result.content, changed: result.refined };
  });

  if (!changed) {
    return { content: input.content, refined: false };
  }

  const normalized = normalize(merged);
  if (countPlainTextChars(normalized) < plainLen * 0.55) {
    console.warn(`[refineContentQuality] 精炼后过短，保留原文（原 ${plainLen} 字）`);
    return { content: input.content, refined: false };
  }

  return { content: normalized, summary: newSummary, refined: true };
}

function buildPolishSystemPrompt(mode: string, scope: "whole" | "block"): string {
  return `你是公众号润色助手。把用户给的 HTML ${scope === "whole" ? "文章" : "片段"}润色成「${mode}」风格。要求保留 HTML 结构，输出 JSON：{ "content": string }。

${ARTICLE_HTML_FORMAT_RULES_BRIEF}

${buildWechatPlatformValueBlock()}

【润色原则】
- 提升信息密度，**合并或删除重复段落**，同一观点只保留表达最清晰的一处
- 去掉 AI 套话与空洞过渡句，换成具体细节；不编造数据来源
- 保留并适当补充 \`<strong>\` 重点标注：每段至少 1 处，标注核心判断或关键术语（2-10 字），禁止删除已有 strong 却不补回
- 润色时不得改变 mp-tip / mp-warning / mp-summary 的固定结构（见上方格式规范）
- 案例不够具体时补充细节，但不可虚构数据来源
- 禁止绝对化表述、空洞鸡汤、夸大承诺、无依据断言
- 「更营销」也只强调真实价值，不用震惊体或虚假宣传
- 「更简洁」优先删水，不要靠压缩把干货删没${
    scope === "block"
      ? "\n- 只返回本片段，保留原有 <h2> 标题文字；不要补写其他章节或过渡句"
      : ""
  }`;
}

/** 润色单块；失败或产出异常时回退原片段，不牵连整篇 */
async function polishHtmlBlock(
  html: string,
  mode: string,
  scope: "whole" | "block",
): Promise<{ content: string; changed: boolean }> {
  const plainLen = countPlainTextChars(html);
  const maxTokens = Math.min(8192, Math.max(1024, Math.ceil(plainLen * 2.2) + 512));

  try {
    const raw = await callChat(
      [
        { role: "system", content: buildPolishSystemPrompt(mode, scope) },
        { role: "user", content: html },
      ],
      { jsonMode: true, maxTokens, role: "polish", temperature: 0.45 },
    );
    const parsed = safeParse<{ content?: string }>(raw, {});
    if (!parsed.content || countPlainTextChars(parsed.content) < plainLen * 0.5) {
      return { content: html, changed: false };
    }
    return { content: parsed.content, changed: true };
  } catch (error) {
    console.error("[polishContent] block failed:", error);
    return { content: html, changed: false };
  }
}

export async function polishContent(input: {
  content: string;
  mode: "更正式" | "更口语" | "更简洁" | "更营销";
}) {
  const plainLen = countPlainTextChars(input.content);

  // 整篇一次润色的响应长度与正文生成同量级，长文同样会撞上游网关超时
  const blocks = splitContentIntoRefineBlocks(input.content);
  if (blocks.length < 2 || plainLen < 1500) {
    const single = await polishHtmlBlock(input.content, input.mode, "whole");
    return normalizeCalloutBlocks(single.changed ? single.content : input.content);
  }

  const { merged, changed } = await processHtmlBlocksInParallel(input.content, (html) =>
    polishHtmlBlock(html, input.mode, "block"),
  );

  if (!changed || countPlainTextChars(merged) < plainLen * 0.5) {
    return normalizeCalloutBlocks(input.content);
  }
  return normalizeCalloutBlocks(merged);
}

/** 单次整理约 1800 字，避免长文一次生成被上游掐断（fetch failed） */
const REFORMAT_CHUNK_PLAIN_CHARS = 1800;

function splitHtmlForReformat(html: string, maxPlain: number): string[] {
  const parts = html
    .split(/(?<=<\/(?:p|h[1-6]|pre|ul|ol|blockquote|div)>)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [html];

  const chunks: string[] = [];
  let buf = "";
  let bufPlain = 0;
  for (const part of parts) {
    const pPlain = countPlainTextChars(part) || part.length;
    if (buf && bufPlain + pPlain > maxPlain) {
      chunks.push(buf);
      buf = part;
      bufPlain = pPlain;
    } else {
      buf += (buf ? "\n" : "") + part;
      bufPlain += pPlain;
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}

async function reformatHtmlChunk(content: string, partIndex: number, partTotal: number): Promise<string> {
  const plainLen = countPlainTextChars(content);
  const maxTokens = Math.min(4096, Math.max(2048, Math.ceil(plainLen * 2.4) + 512));

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是公众号排版助手。用户给出的是文章的第 ${partIndex}/${partTotal} 段（可能是纯文本、Markdown 或结构混乱的 HTML）。只整理这一段的排版，输出规范微信 HTML 片段。

${ARTICLE_HTML_FORMAT_RULES_BRIEF}

【硬性约束】
- 输出 JSON：{ "content": string }，content 为本段 HTML 片段（不要包 html/body）
- **禁止改写、扩写、删减、润色措辞**：观点、事实、代码、注释、标点尽量原样保留；只改标签与分段结构
- 识别并包裹代码：\`\`\` 围栏、连续 import/函数体等 → <pre><code class="language-xxx">...</code></pre>
- 小标题 → <h2>/<h3>；段落 → <p>；步骤/要点 → ol/ul，列表项 <li><strong>短标题</strong>说明</li>
- Markdown **加粗** → <strong>；禁止输出 Markdown 语法
- 不要新增原文没有的「总结 / 引流 / 关注」；禁止 figure、img、table、inline style、自创 class`,
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "reformat_chunk",
        part: partIndex,
        totalParts: partTotal,
        plainChars: plainLen,
        content,
      }),
    },
  ];

  const raw = await callChat(prompt, {
    jsonMode: true,
    maxTokens,
    role: "reformat",
    temperature: 0.15,
  });
  if (!raw) {
    throw new Error(`模型未返回结果（第 ${partIndex}/${partTotal} 段），请稍后重试`);
  }
  const parsed = safeParse<{ content?: string }>(raw, {});
  if (!parsed.content || countPlainTextChars(parsed.content) < Math.min(20, plainLen * 0.25)) {
    throw new Error(`格式整理失败：第 ${partIndex}/${partTotal} 段输出无效`);
  }
  return parsed.content.trim();
}

/**
 * 仅整理导入/手写稿格式：按正文生成同一套微信 HTML 规则输出，禁止改写文意。
 * 长文自动分段请求，避免单次超长 completion 被网关断开。
 */
export async function reformatArticleHtml(input: {
  content: string;
  onProgress?: (progress: number, label: string) => Promise<void> | void;
}) {
  if (!isAiConfigured()) {
    throw new Error("未配置 AI API Key，无法整理格式");
  }

  const chunks = splitHtmlForReformat(input.content, REFORMAT_CHUNK_PLAIN_CHARS);
  let done = 0;

  // 各块互不依赖，并发处理；进度按完成数上报
  const out = await mapWithConcurrency(
    chunks,
    getSectionConcurrency(chunks.length),
    async (chunk, i) => {
      const result = await withRetry(
        () => reformatHtmlChunk(chunk, i + 1, chunks.length),
        { attempts: 3, baseDelayMs: 1200 },
      );
      done += 1;
      const label = chunks.length === 1 ? "整理格式中" : `整理格式 ${done}/${chunks.length}`;
      await input.onProgress?.(30 + Math.floor((done / chunks.length) * 50), label);
      return result;
    },
  );

  const merged = out.join("\n");
  return highlightCodeBlocks(
    dedupeRepeatedBlocks(fixCodeBlocks(normalizeCalloutBlocks(merged))),
  );
}

function buildExpandSystemPrompt(scope: "whole" | "block"): string {
  return `你是公众号扩写助手。把用户给出的${scope === "whole" ? "整篇 HTML 正文" : "HTML 片段"}扩写得更充实，然后输出${scope === "whole" ? "完整 HTML" : "该片段的 HTML"}。

${ARTICLE_HTML_FORMAT_RULES_BRIEF}

【扩写要求】
- 输出 JSON：{ "content": string }，content 必须是扩写后的**${scope === "whole" ? "完整正文" : "完整片段"} HTML**（不是增量片段）
- 在${scope === "whole" ? "各章节" : "本章"}内部补充具体案例、步骤、对比或细节，保持原有结构与风格
- 禁止只在末尾追加一段；禁止重复粘贴「总结核心动作 / 小练习」等模板套话
- 禁止把原文原样复制后再拼接一遍
- 扩写要有实质信息增量，不注水、不鸡汤、不堆 AI 套话；有判断处可自然用 <strong> 标注 2-8 字核心词
- 每补一段都要能通过：删掉后读者是否少懂一件具体事
- 禁止绝对化表述和无依据断言；不得引入格式规范以外的 HTML 结构
- 扩写后字数应明显多于原文，但宁可少扩也不要空话${
    scope === "block" ? "\n- 只返回本片段，保留原有 <h2> 标题文字；不要补写其他章节" : ""
  }

${buildWechatPlatformValueBlock()}`;
}

/** 扩写单块；失败或没变长时回退原片段 */
async function expandHtmlBlock(
  html: string,
  instruction: string,
  scope: "whole" | "block",
): Promise<{ content: string; changed: boolean }> {
  const originalPlain = countPlainTextChars(html);
  const maxTokens = Math.min(8192, Math.max(1536, Math.ceil(html.length / 2) + 1600));

  try {
    const raw = await callChat(
      [
        { role: "system", content: buildExpandSystemPrompt(scope) },
        {
          role: "user",
          content: JSON.stringify({ content: html, instruction, originalPlainChars: originalPlain }),
        },
      ],
      { jsonMode: true, maxTokens, role: "expand" },
    );
    const parsed = safeParse<{ content?: string }>(raw, {});
    if (!parsed.content || countPlainTextChars(parsed.content) <= originalPlain) {
      return { content: html, changed: false };
    }
    return { content: parsed.content, changed: true };
  } catch (error) {
    console.error("[expandSection] block failed:", error);
    return { content: html, changed: false };
  }
}

export async function expandSection(input: {
  content: string;
  instruction?: string;
}) {
  if (!isAiConfigured()) {
    throw new Error("未配置 AI API Key，无法扩写");
  }

  const originalPlain = countPlainTextChars(input.content);
  const instruction = input.instruction ?? "补具体例子和执行步骤";
  const blocks = splitContentIntoRefineBlocks(input.content);

  // 扩写的输出必然比输入更长，整篇一次做最容易超时，长文按章并发
  const { merged, changed } =
    blocks.length < 2
      ? await expandHtmlBlock(input.content, instruction, "whole").then((r) => ({
          merged: r.content,
          changed: r.changed,
        }))
      : await processHtmlBlocksInParallel(input.content, (html) =>
          expandHtmlBlock(html, instruction, "block"),
        );

  if (!changed) {
    throw new Error("扩写失败：正文几乎没有变长，请重试");
  }

  const expanded = normalizeCalloutBlocks(merged);
  if (countPlainTextChars(expanded) <= originalPlain + 40) {
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
  "Premium internet-tech editorial illustration. Deep navy-to-black gradient background with a subtle dark-mode UI feel. Glassmorphism cards with frosted translucent panels, thin luminous borders, and soft cyan/blue glow. Refined geometric line work, faint circuit traces and data-flow lines, micro grid texture. High-end SaaS / developer-tool aesthetic — sleek, modern, premium, never childish. Cinematic rim lighting, depth of field, subtle particle dust. Never flat cartoon, never hand-drawn doodle, never pastel macaron.";

/** 封面专用：深色科技横幅（Node.js 安全、ADB 工具箱类） */
const COVER_STYLE_DARK =
  "Dark premium tech article banner, 16:9. Deep navy-to-black gradient with subtle starfield particles, faint circuit traces, and soft cyan or emerald glow. One large 3D isometric hero object as focal point (shield with lock, Android robot outline, terminal window, API nodes, workflow diagram — must match topic). Optional small floating holographic UI badges with icons only. Bold Chinese headline typography. Sleek developer-tool / cybersecurity promo aesthetic. Never cartoon people with faces, never cluttered keyword chip rows.";

/** 封面专用：浅色产品风（v0.dev、Tauri、面试题类） */
const COVER_STYLE_LIGHT =
  "Clean light tech article banner, 16:9. Soft sky-blue to white gradient with generous negative space. Left side: bold dark Chinese headline (1-2 lines) with crisp sans-serif typography. Right side: floating 3D UI mockups, glass dashboard panels, or isometric widgets with soft shadows. Modern SaaS product-marketing feel — minimal, airy, professional. Never dark cyberpunk background, never neon overload, never keyword chip rows.";

const COVER_LAYOUT_VARIANTS = [
  "LEFT_TITLE_RIGHT_HERO: bold Chinese headline on the left third (main line + smaller subtitle below); right two-thirds shows one large 3D isometric illustration related to the topic",
  "BOTTOM_TITLE_CENTER_HERO: dominant 3D metaphor icon centered in the upper area; bottom band has bold white Chinese headline and subtitle with subtle glow",
  "CENTER_TITLE_ABSTRACT: dark blue background with flowing cyan light waves or data streams; centered bold white Chinese headline, minimal decoration",
  "DIAGONAL_SPLIT: diagonal luminous band divides canvas; headline on the darker side, 3D tech object on the lighter side",
] as const;

const SECTION_LAYOUT_VARIANTS = [
  "HORIZONTAL FLOW: 3-4 frosted glass cards in a left-to-right row, connected by glowing data-flow lines",
  "2x2 GRID: four glass cards in a balanced grid with subtle luminous connecting lines",
  "CENTRAL HUB: one larger hero glass card with 3 smaller satellite cards around it, linked by thin light beams",
  "VERTICAL TIMELINE: glass cards stacked top-to-bottom along a vertical light trail with step numbers in glowing circles",
  "TWO-COLUMN CONTRAST: left vs right comparison — two tall glass panels facing each other with a vs/arrow divider",
  "PROCESS FUNNEL: glass cards arranged in a gentle funnel or pyramid showing progression",
  "RADIAL SPOKES: keyword cards placed around a central holographic icon like a mind-map (no photoreal faces)",
  "LAYERED STACK: 3 glass cards slightly offset in 3D depth with soft shadows and depth-of-field",
  "JOURNEY MAP: glass cards placed along a winding light path across the canvas",
  "TOOLBOX SCENE: glass cards emerging from a sleek floating dashboard / dock panel",
] as const;

const SECTION_METAPHOR_VARIANTS = [
  "faint blueprint grid and circuit traces in background",
  "floating geometric shapes (hexagons, triangles) with soft glow as secondary decoration",
  "data packet particles and connection nodes drifting between cards",
  "subtle node-link network mesh as ambient decoration",
  "light beams and lens flares for performance/speed metaphor",
  "puzzle-piece connectors with luminous edges between cards",
  "magnifying glass and checklist icons with cyan glow near labels",
  "bridge or link chain of glowing nodes connecting two concepts",
  "compass or map pin with holographic ring for navigation/direction metaphor",
  "gear and circuit-line doodles with subtle bloom for engineering topics",
] as const;

const SECTION_ACCENT_COLORS = [
  "electric cyan as dominant accent",
  "deep sapphire blue as dominant accent",
  "violet indigo as dominant accent",
  "emerald teal as dominant accent",
  "warm gold as dominant accent",
  "magenta pink as dominant accent",
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
- Vary card shapes subtly when fitting: rounded glass rects, tags, hexagons, holo-panels, chips
- Vary decorative elements: stars, sparkles, arrows, light beams, particle dust, plus badges, nodes — don't repeat the same set every time
- Pick icons that match the section topic (code brackets, database cylinder, form checkbox, clock, shield, etc.) — not generic lightbulb every time

CONTENT:
- Do NOT just render the section heading as the main text
- Extract 3-5 concrete keywords, methods, tools, or concepts from sectionContent (2-6 Chinese characters each)
- Place each keyword inside its own glass card / chip with a small luminous icon
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
    `${IMAGE_STYLE_ANCHOR} Illustration about ${cleanHeading}. ${variant.layout}. ${variant.metaphor}. ${variant.accentColor}. Chinese keyword labels inside frosted glass cards.`,
    variant,
  );
}

function reinforceSectionPrompt(
  prompt: string,
  variant: ReturnType<typeof pickSectionVisualVariant>,
): string {
  const lower = prompt.toLowerCase();
  const hints: string[] = [];
  if (!/glass|navy|cyan|premium|tech|circuit|gradient/i.test(prompt)) {
    hints.push(IMAGE_STYLE_ANCHOR);
  }
  if (!/chinese|中文|汉字/i.test(lower)) {
    hints.push("Chinese keyword labels (2-6 characters) inside each glass card.");
  }
  if (!/layout|grid|timeline|hub|funnel|map|toolbox|radial|stack/i.test(lower)) {
    hints.push(variant.layout);
  }
  if (hints.length === 0) return prompt.trim();
  return `${prompt.trim()} ${hints.join(" ")}`;
}

/** 封面主副标题：参照 v0.dev / Node.js 安全横幅，用大标题而非底部关键词卡片 */
function deriveCoverTitleLines(
  title: string,
  summary?: string | null,
  keyPoints: string[] = [],
): { headline: string; subtitle: string } {
  const headline = title
    .replace(/[《》【】\[\]（）()「」""'']/g, "")
    .trim()
    .slice(0, 18);
  const summaryLine = (summary ?? "")
    .replace(/[，。！？、；：]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  const pointLine = keyPoints
    .map((p) => p.replace(/[0-9０-９]+[.、．)\]]\s*/g, "").trim())
    .find((p) => p.length >= 4 && p.length <= 16);
  const subtitle = summaryLine || pointLine || "实用拆解";
  return { headline: headline || "技术专题", subtitle };
}

const LIGHT_COVER_TOPIC_RE =
  /前端|ui|ux|设计|v0|tauri|组件|样式|css|面试|轻量|桌面|tsx|react|vue|svelte|tailwind|动效|布局/i;

function pickCoverTheme(topic: string, title: string): "dark" | "light" {
  const corpus = `${topic}${title}`;
  if (LIGHT_COVER_TOPIC_RE.test(corpus)) {
    return "light";
  }
  return "dark";
}

function pickCoverVisualVariant(topic: string, title: string) {
  let hash = 0;
  for (let i = 0; i < topic.length; i++) hash = (hash + topic.charCodeAt(i)) | 0;
  const layout = COVER_LAYOUT_VARIANTS[Math.abs(hash) % COVER_LAYOUT_VARIANTS.length];
  const theme = pickCoverTheme(topic, title);
  const styleAnchor = theme === "light" ? COVER_STYLE_LIGHT : COVER_STYLE_DARK;
  return { layout, theme, styleAnchor };
}

const LIFESTYLE_COVER_KEYWORD_RE =
  /美食|旅行|旅游|攻略|生活小技巧|文化漫谈|穿搭|护肤|美食推荐|生活方式|理财|星座|情感|养生|家居|亲子/;

/** 用英文描述主题域，避免把中文主题原文塞进生图 prompt（易被画到角落） */
function coverDomainHint(topic: string): string {
  const t = topic.toLowerCase();
  if (/agent|智能体|claude|cursor|copilot|编码助手/.test(t)) return "AI coding assistants and developer workflows";
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
  const { headline, subtitle } = deriveCoverTitleLines(
    title,
    context?.summary,
    keyPoints,
  );
  const variant = pickCoverVisualVariant(topic, title);
  const domainHint = coverDomainHint(topic);
  const contentExcerpt = (context?.contentExcerpt ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);

  const prompt = await callChat([
    {
      role: "system",
      content: IMAGE_PROMPT_SYSTEM + `\n\nCreate a WeChat article COVER banner (16:9). Match premium tech blog thumbnails — bold Chinese headline + one hero 3D illustration, NOT a row of small keyword cards.

STYLE ANCHOR (fixed for this cover):
${variant.styleAnchor}

LAYOUT (use exactly this composition):
${variant.layout}

TOPIC VISUALS:
- Domain: ${domainHint}
- Pick ONE large 3D hero metaphor that fits the article (shield/lock for security, Android robot for mobile tools, code terminal for CLI, dashboard panels for frontend, agent nodes for AI)
- Small floating UI badges OK for decoration — icons only, no extra Chinese labels

TEXT RULES (critical):
- The ONLY Chinese text in the image: headline 「${headline}」 and subtitle 「${subtitle}」
- Headline: large, bold, high contrast — main visual text element
- Subtitle: smaller, below or beside headline
- NEVER use a horizontal row of 3-4 frosted glass keyword chips at the bottom — that layout is forbidden
- NEVER paint the raw articleTopic string as a corner watermark
- FORBIDDEN unless the article is about them: 美食推荐、旅行攻略、生活小技巧、文化漫谈、穿搭、护肤

Output JSON: { "prompt": string }
In "prompt": describe visuals in English; specify exact Chinese headline and subtitle text and their placement.`,
    },
    {
      role: "user",
      content: JSON.stringify({
        domainHint,
        theme: variant.theme,
        layoutVariant: variant.layout,
        headline,
        subtitle,
        contextForMeaningOnly: {
          articleTopic: topic,
          articleTitle: title,
          summary: context?.summary || "",
          keyPoints,
          contentExcerpt: contentExcerpt || undefined,
        },
        doNotPaintTheseStrings: [topic].filter((s) => s !== headline && s !== subtitle),
      }),
    },
  ], { jsonMode: true, maxTokens: 480, role: "cover-prompt" });

  const parsed = safeParse<{ prompt?: string }>(prompt, {});

  if (parsed.prompt) {
    return reinforceCoverPrompt(parsed.prompt, headline, subtitle, variant);
  }

  return reinforceCoverPrompt(
    `${variant.styleAnchor} ${variant.layout}. ` +
      `Bold Chinese headline 「${headline}」 with subtitle 「${subtitle}」. ` +
      `One large 3D isometric hero illustration about ${domainHint}. ` +
      `No keyword chip row. No corner watermarks.`,
    headline,
    subtitle,
    variant,
  );
}

/** 追加封面约束：大标题横幅风，禁止底部关键词卡片 */
function reinforceCoverPrompt(
  prompt: string,
  headline: string,
  subtitle: string,
  variant: ReturnType<typeof pickCoverVisualVariant>,
): string {
  let cleaned = prompt.trim();

  const hints = [
    variant.styleAnchor,
    `Layout: ${variant.layout}.`,
    `Headline text must be exactly 「${headline}」 — large, bold, prominent.`,
    `Subtitle text must be exactly 「${subtitle}」 — smaller, secondary.`,
    "FORBIDDEN: horizontal row of 3-4 small glass cards with keyword labels at the bottom.",
    "FORBIDDEN: text in top-left or top-right corners as watermarks.",
    "No cartoon people with faces. No cluttered chip/tag rows.",
  ];

  if (LIFESTYLE_COVER_KEYWORD_RE.test(cleaned)) {
    hints.push(
      "Remove lifestyle labels such as 美食推荐/旅行攻略/生活小技巧 — off-topic.",
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
