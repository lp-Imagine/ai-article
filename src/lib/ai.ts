import type { OutlineOption } from "@/types/article";
import { getEnvValue } from "@/lib/config-bridge";
import { highlightCodeBlocks } from "@/lib/code-highlight";
import { enforceArticleHtmlFormat, normalizeArticleMarkup, normalizeCalloutBlocks } from "@/lib/wechat-style";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { analyzeContentQuality, sanitizeFactualClaimsInHtml } from "@/lib/content-quality";
import { isTransientNetworkError, withRetry } from "@/lib/retry";

type TextRole =
  | "outline"
  | "content"
  | "summary"
  | "titles"
  | "topic-ideas"
  | "cover-prompt"
  | "polish"
  | "expand"
  | "section-image"
  | "reformat"
  | "refine";

const PRIMARY_TEXT_ROLES: ReadonlySet<TextRole> = new Set<TextRole>([
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

// 抽到子模块的 prompt / 常量
import {
  buildAccountPersonaBlock,
  buildDomainAdaptationBlock,
  buildStyleGuide,
  buildWritingUserPayload,
  isEngineeringTopic,
  ARTICLE_HTML_FORMAT_RULES_BRIEF,
} from "@/lib/ai/prompts/common";
import {
  buildOutlinePrompt,
  type OutlinePromptInput,
} from "@/lib/ai/prompts/outline";
// 抽到子模块的 prompt builder
import { buildContentSystemPromptCore } from "@/lib/ai/prompts/content";
import { buildRefineSystemPrompt } from "@/lib/ai/prompts/refine";
import { buildPolishSystemPrompt } from "@/lib/ai/prompts/polish";
import { buildExpandSystemPrompt } from "@/lib/ai/prompts/expand";
import {
  buildInfographicPrompt,
  type SectionStoryPanel,
  type SectionStoryboard,
} from "@/lib/ai/prompts/cover";
import {
  BLUEPRINT_JSON_INSTRUCTION,
  CONTENT_SKILL,
  fallbackBlueprint,
  normalizeBlueprint,
  sectionDirective,
  type ArticleBlueprint,
} from "@/lib/ai/skills/content";
import {
  assessOutlineDiversity,
  outlineAngleAt,
} from "@/lib/ai/skills/outline";
import { buildQualityRepairBrief } from "@/lib/ai/skills/refine";
import { SECTION_ATTEMPTS } from "@/lib/ai/constants";
import {
  extractHtmlFromLlmJson,
  extractSectionHtml,
} from "@/lib/ai/extract-html";


function readConfig(key: string, fallback: string): string {
  const value = getEnvValue(key) ?? process.env[key];
  return value && value.trim() ? value : fallback;
}

function isAiConfigured() {
  return Boolean(getEnvValue("AI_API_KEY") || process.env.AI_API_KEY);
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
        choices?: Array<{
          finish_reason?: string | null;
          text?: string | null;
          message?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
          };
        }>;
        usage?: { completion_tokens?: number };
      };

      const seconds = (Date.now() - startedAt) / 1000;
      const outTokens = json.usage?.completion_tokens ?? 0;
      const finish = json.choices?.[0]?.finish_reason ?? "";
      const truncated = finish === "length" || outTokens >= maxTokens * 0.98;
      console.log(
        `[llm] role=${role} ${seconds.toFixed(1)}s inflight=${inFlightAtStart} ` +
          `out=${outTokens}tok${outTokens ? ` ${(outTokens / seconds).toFixed(1)}tok/s` : ""} cap=${maxTokens}` +
          `${finish ? ` finish=${finish}` : ""}${truncated ? " truncated" : ""}`,
      );

      return pickChatMessageContent(json);
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

function pickChatMessageContent(json: {
  choices?: Array<{
    text?: string | null;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
  }>;
}): string {
  const choice = json.choices?.[0];
  const msg = choice?.message;
  // 只认 content（最终答案）。reasoning_content / reasoning 是模型思考过程，
  // 绝不是交付物：模型在 max_tokens 截断时常返回「空 content + 长思考」，
  // 若回退到思考过程，会被当成章节正文/JSON 发布（线上出现过章节内容变成
  // 「写作规划」的泄漏事故）。content 为空时返回空串，交给调用方的重试/失败逻辑。
  const content = typeof msg?.content === "string" ? msg.content : "";
  if (content.trim()) return content;
  // 兼容非 chat 形态的 OpenAI 兼容端点（answer 在顶层 text 字段）
  if (typeof choice?.text === "string" && choice.text.trim()) return choice.text;
  return "";
}

function getLlmTimeoutMs(role: TextRole): number {
  const raw = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (
    role === "content" ||
    role === "polish" ||
    role === "expand" ||
    role === "reformat" ||
    role === "refine"
  ) {
    return 180_000;
  }
  if (role === "outline") return 180_000;
  if (role === "topic-ideas") return 25_000; // 灵感热点：命中缓存秒回；冷启动等模型，超时降级静态库
  return 120_000;
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function computeContentMaxTokens(wordCount: number): number {
  // 中文 + HTML + JSON 包装，约 2 token/字，留生成余量
  return Math.min(8192, Math.max(4096, Math.ceil(wordCount * 2.2)));
}

/** 单章输出上限。工程章带代码块，2048 会把 JSON 截断导致整章作废。 */
function computeSectionMaxTokens(perSection: number, engineering: boolean): number {
  const floor = engineering ? 4096 : 3072;
  return Math.min(8192, Math.max(floor, Math.ceil(perSection * 3.2) + 1200));
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
    sections: (opt.sections ?? []).map((section) => ({
      heading: section.heading ?? "未命名章节",
      summary: section.summary ?? "",
    })),
  };
}

function reportOutlineDiversity(outlines: OutlineOption[]): OutlineOption[] {
  const diversity = assessOutlineDiversity(outlines);
  if (diversity.issues.length > 0) {
    console.warn(
      `[generateOutline] diversity=${diversity.score}: ${diversity.issues.join("；")}`,
    );
  }
  return outlines;
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
  const sectionCount =
    wordCount <= 1200 ? 3 : wordCount <= 2000 ? 4 : wordCount <= 3000 ? 5 : 6;

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
    if (parallel.length > 0) return reportOutlineDiversity(parallel);
    return reportOutlineDiversity(buildFallbackOutlines(
      input.topic,
      style,
      audience,
      wordCount,
      count,
      engineering,
    ));
  }

  const raw = await callChat(
    buildOutlinePrompt({
      ...input,
      style,
      audience,
      wordCount,
      count,
      sectionCount,
      engineering,
      angle: null,
    }),
    {
      jsonMode: true,
      maxTokens: Math.min(8192, 1600 + count * sectionCount * 220),
      role: "outline",
    },
  );
  const parsed = safeParse<{ outlines?: OutlineOption[] }>(raw, {});
  if (parsed.outlines?.length) {
    return reportOutlineDiversity(parsed.outlines
      .slice(0, count)
      .map((option, index) =>
        normalizeOutlineOption(option, index, input.topic, style, wordCount),
      ));
  }

  return reportOutlineDiversity(buildFallbackOutlines(
    input.topic,
    style,
    audience,
    wordCount,
    count,
    engineering,
  ));
}


/** 每套方案一个短请求并发生成：单次响应更小，几乎不会撞上网关超时 */
async function generateOutlinesInParallel(
  input: Omit<OutlinePromptInput, "angle">,
): Promise<OutlineOption[]> {
  const { topic, style, wordCount, count, sectionCount } = input;
  const maxTokens = Math.min(4096, 1200 + sectionCount * 260);

  const results = await mapWithConcurrency(
    Array.from({ length: count }, (_, i) => i),
    getOutlineConcurrency(count),
    async (i) => {
      try {
        const raw = await callChat(
          buildOutlinePrompt({ ...input, angle: outlineAngleAt(i) }),
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


function finalizeGeneratedContent(
  content: string,
  fallbackTitle: string,
  fallbackSummary: string,
): {
  title: string;
  summary: string;
  content: string;
  missingSections: string[];
  promptVersions: { content: string };
} {
  const safeContent = content
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/g, "")
    .replace(/<div class="mp-signature">[\s\S]*?<\/div>/g, "");
  const fixedContent = dedupeRepeatedBlocks(fixCodeBlocks(normalizeCalloutBlocks(safeContent)));
  const sanitized = sanitizeFactualClaimsInHtml(fixedContent);
  const highlightedContent = highlightCodeBlocks(sanitized.content);
  return {
    title: fallbackTitle,
    summary: fallbackSummary,
    content: highlightedContent,
    missingSections: [],
    promptVersions: { content: CONTENT_SKILL.version },
  };
}

/** 模型思考/写作规划文本的特征（出现在泄漏事故里，正常正文几乎不会命中） */
const REASONING_LEAK_PATTERNS: RegExp[] = [
  /需要(?:写出|给出|控制|注意|合理|整合|定义)/,
  /注意[:：]?HTML/,
  /不能重复前/,
  /我们(?:需|要|可以|还)/,
  /约\d+(?:字|个)/,
  /先写HTML|输出推荐方案|可以返回/,
];

/**
 * 判断提取出的"章节 HTML"是否其实是模型的思考规划文本。
 * 正常章节正文不会出现「需要控制字数」「注意：HTML格式」「不能重复前四章」
 * 这类写作指令；命中 2 个以上特征即视为泄漏，应拒绝并重试。
 */
export function looksLikeModelReasoning(html: string): boolean {
  const plain = html.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  if (!plain) return false;
  let hits = 0;
  for (const re of REASONING_LEAK_PATTERNS) {
    if (re.test(plain)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

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
  blueprint: ArticleBlueprint;
}): Promise<string> {
  const { section } = input;
  const maxTokens = computeSectionMaxTokens(input.perSection, input.engineering);
  let lastError = "模型未返回有效内容";
  let forcePlain = false;

  for (let attempt = 0; attempt < SECTION_ATTEMPTS; attempt++) {
    // JSON 被截断或返回空内容后，后续轮次改纯 HTML，避免反复撞同一个 json_object 上限
    const plainMode = forcePlain || attempt === SECTION_ATTEMPTS - 1;

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
${input.isLastSummary ? '- 最后一章可用 <div class="mp-summary"><p>...</p></div>' : ""}

${sectionDirective(input.blueprint, input.sectionIndex - 1)}`,
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
              articleAngle: input.blueprint.angle,
              articleThesis: input.blueprint.thesis,
            }),
          },
        ],
        { jsonMode: !plainMode, maxTokens, role: "content", temperature: 0.65, retries: 2 },
      );

      if (!sectionRaw) {
        lastError = "模型返回空内容（输出可能被 token 上限截断）";
        forcePlain = true;
      } else {
        const html = extractSectionHtml(sectionRaw, !plainMode);
        if (html.length >= 60) {
          // 防线：即使 content 里混入思考规划文本（reasoning 泄漏），
          // 也不让它进入正文，改为重试/失败，而不是发布垃圾章节。
          if (!looksLikeModelReasoning(html)) return html;
          lastError = "模型输出了思考规划而非正文（疑似 reasoning 泄漏）";
          forcePlain = true;
          console.warn(
            `[generateContentBySections] section ${input.sectionIndex} reasoning leak`,
            sectionRaw.slice(0, 200),
          );
        } else {
          lastError = `输出过短或字段缺失（${html.length} 字）`;
          forcePlain = true;
          console.warn(
            `[generateContentBySections] section ${input.sectionIndex} attempt ${attempt + 1} short output`,
            sectionRaw.slice(0, 200),
          );
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "章节生成失败";
      forcePlain = true;
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
  const blueprintFallback = fallbackBlueprint({
    topic: input.topic,
    outline: input.outline,
    engineering,
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

【本次任务：标题 + 摘要 + 开篇 + 全篇蓝图】
输出 JSON：{ "title": string, "summary": string, "openingHtml": string, "blueprint": object }
- title ≤ 20 字；summary 80-120 字
- openingHtml：开篇 2-4 段 <p>（直接点题），**不要** <h2>，不要写正文章节

${BLUEPRINT_JSON_INSTRUCTION}`,
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
    {
      jsonMode: true,
      maxTokens: Math.min(4096, 1600 + sections.length * 320),
      role: "content",
      temperature: 0.65,
    },
  );
  const meta = safeParse<Record<string, unknown>>(metaRaw, {});
  const blueprint = normalizeBlueprint(meta.blueprint, blueprintFallback);
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
          blueprint,
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
  if (sections.length > 0 && failedHeadings.length === sections.length) {
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
  const monolithicOutline: OutlineOption = input.outline ?? {
    index: 0,
    title: input.topic,
    positioning: `${style}文章，围绕一个核心判断展开。`,
    sections,
  };
  const blueprint = fallbackBlueprint({
    topic: input.topic,
    outline: monolithicOutline,
    engineering,
  });
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
    sectional: false,
  });

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `${systemCore}

【全篇蓝图】
- 切入角：${blueprint.angle}
- 核心判断：${blueprint.thesis}
- 读者冲突：${blueprint.readerTension}
- 开篇方式：${blueprint.openingMode}
- 结尾交付：${blueprint.endingMode}
- 逐章合同：
${blueprint.sectionPlans
  .map(
    (plan, index) =>
      `${index + 1}. ${plan.heading}：只交付「${plan.uniqueContribution}」；证据用 ${plan.evidenceMode}（${plan.evidencePlan}）`,
  )
  .join("\n")}

【输出】
JSON：{ "title", "summary", "content" }
- summary：80-120 字，写清读者能带走什么（一个动作/判断标准/清单）
- content：完整 HTML（无 h1、无签名引流）
- title 不超过 20 字；篇幅参考 ${wordCount} 字，质量与切题优先于凑字数`,
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


/** 单块精炼；任何异常/异常输出都回退原文 */
async function refineHtmlBlock(input: {
  topic: string;
  title?: string | null;
  style?: string | null;
  html: string;
  wantSummary: boolean;
  summary?: string | null;
  repairBrief?: string;
}): Promise<{ content: string; summary?: string; refined: boolean }> {
  const plainLen = countPlainTextChars(input.html);
  const maxTokens = Math.min(8192, Math.max(1024, Math.ceil(plainLen * 2.2) + 600));

  try {
    const raw = await callChat(
      [
        {
          role: "system",
          content: buildRefineSystemPrompt(
            input.topic,
            input.wantSummary ? "whole" : "block",
            input.repairBrief,
          ),
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
            repairBrief: input.repairBrief || undefined,
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
  const repairBrief = buildQualityRepairBrief(preCheck);
  if (preCheck.score >= getRefineMinScore()) {
    const hasHighFactual = preCheck.factualFindings.some((f) => f.severity === "high");
    if (!hasHighFactual) {
      return { content: input.content, refined: false, skipped: true };
    }
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
      repairBrief,
    });
    return single.refined
      ? { ...single, content: normalize(single.content) }
      : { content: input.content, refined: false };
  }

  let newSummary: string | undefined;
  const { merged, changed } = await processHtmlBlocksInParallel(input.content, async (html, i) => {
    const blockCheck = analyzeContentQuality({
      title: i === 0 ? input.title : null,
      summary: i === 0 ? input.summary : null,
      content: html,
    });
    const blockRepairBrief = buildQualityRepairBrief({
      // 单个章节天然可能少于 400 字，不把整篇的长度门槛当成章节缺陷。
      issues: blockCheck.issues.filter((issue) => issue.code !== "too_short"),
      suggestions: [],
    });
    if (!blockRepairBrief) {
      return { content: html, changed: false };
    }
    const result = await refineHtmlBlock({
      topic: input.topic,
      title: input.title,
      style: input.style,
      html,
      wantSummary: i === 0,
      summary: input.summary,
      repairBrief: blockRepairBrief,
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

/** 不调用模型，仅用本地规则整理 HTML 片段（导入/AI 失败时的兜底） */
function locallyReformatHtmlChunk(content: string): string {
  return highlightCodeBlocks(
    fixCodeBlocks(normalizeCalloutBlocks(enforceArticleHtmlFormat(normalizeArticleMarkup(content)))),
  );
}

async function reformatHtmlChunk(content: string, partIndex: number, partTotal: number): Promise<string> {
  const plainLen = countPlainTextChars(content);
  const fallback = () => {
    const local = locallyReformatHtmlChunk(content);
    if (countPlainTextChars(local) >= Math.min(20, plainLen * 0.5)) {
      return local;
    }
    return content;
  };

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

  try {
    const raw = await callChat(prompt, {
      jsonMode: true,
      maxTokens,
      role: "reformat",
      temperature: 0.15,
      retries: 3,
    });
    if (!raw) {
      console.warn(`[reformat] empty model response part ${partIndex}/${partTotal}, using local pipeline`);
      return fallback();
    }
    const parsed = safeParse<{ content?: string }>(raw, {});
    if (!parsed.content || countPlainTextChars(parsed.content) < Math.min(20, plainLen * 0.25)) {
      console.warn(`[reformat] invalid model output part ${partIndex}/${partTotal}, using local pipeline`);
      return fallback();
    }
    return parsed.content.trim();
  } catch (error) {
    console.warn(
      `[reformat] AI failed part ${partIndex}/${partTotal}, using local pipeline:`,
      error instanceof Error ? error.message : error,
    );
    return fallback();
  }
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

/**
 * LLM 生成当下热点选题（前端 / AI / Agent / 程序员方向）。
 * 用于「给个灵感」增强：替代写死的静态热点库，让选题随时间保持新鲜。
 * 未配置 AI 或调用失败时返回空数组，由调用方降级到静态热点。
 */
export async function generateHotTopics(input: {
  section?: string | null;
  sectionTags?: string[];
  count?: number;
  /** 换一批批次号，促使模型换一批不同选题 */
  batch?: number;
  /** 选题分类方向（如「职场成长」「商业副业」），切换分类时让模型换赛道 */
  categoryLabel?: string;
  /** 近期已展示过的选题，要求模型避开，避免重复 */
  avoid?: string[];
}): Promise<Array<{ topic: string; angle: string; tags: string[] }>> {
  if (!isAiConfigured()) return [];

  const count = Math.max(4, Math.min(10, input.count ?? 6));
  const batch = Number.isFinite(input.batch) ? Math.max(0, Number(input.batch)) : 0;
  const focusAreas =
    input.sectionTags && input.sectionTags.length > 0
      ? input.sectionTags.join("、")
      : "前端工程、全栈实践、AI 应用、AI Agent / 编程助手、TypeScript / Node 工程化";
  const categoryLabel = input.categoryLabel?.trim();
  const isGeneralCategory =
    typeof categoryLabel === "string" &&
    categoryLabel.length > 0 &&
    !/前端|全栈|AI|Agent|工程|后端|系统|技术|编程/.test(categoryLabel);
  const avoid = (input.avoid ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 12);
  const today = new Date().toISOString().slice(0, 10);

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content: `你是资深${
        isGeneralCategory ? "公众号" : "技术"
      }内容策划，长期跟踪${
        isGeneralCategory
          ? "职场、商业、副业、生活、健康、写作等领域"
          : "前端、全栈、AI、AI Agent、程序员效率领域的社区动态（GitHub、Hacker News、掘金、X、公众号）"
      }。

【任务】生成 ${count} 个「当下有讨论度」的公众号选题。

【硬性要求】
- 选题贴合 ${today} 前后 3-6 个月内的${
        isGeneralCategory ? "" : "技术"
      }热点：新发布的工具/框架/模型、正在演进的实践、持续争议的工程话题
- 领域聚焦：${focusAreas}
${categoryLabel ? `- **本次分类**：${categoryLabel}，选题必须围绕该分类展开，不要跨到其他领域` : ""}
- **比例约束**：${
        isGeneralCategory
          ? "全部选题属于该分类，内容要具体、可落地、有真实场景，避免空泛鸡汤和口号"
          : "至少 80% 选题属于前端 / 全栈 / AI / Agent / 工程效率；综合向（职场鸡汤、理财、生活）最多 1 条，且必须和技术人处境强相关"
      }
- 每个选题要落到**具体**工具名 / 版本 / 协议 / 实践（如 MCP、Cursor Rules、RSC、Tailwind v4、向量数据库、Next.js），禁止"AI 时代""大模型趋势"这类空泛大词
- 避免写烂的入门科普（什么是 React / JS 基础语法），面向有 1-3 年经验的工程师
- 角度多样：踩坑复盘 / 对比选型 / 工程落地 / 趋势判断 / 效率工具，至少覆盖 3 种
- 选题 12-24 字，可含具体技术名词；不要标题党、不要震惊体
${batch > 0 ? `- 这是第 ${batch + 1} 批刷新：请给出与常见首批选题明显不同的新角度/新工具，避免重复上一批` : ""}
${avoid.length > 0 ? `- **避免重复**：以下选题近期已展示给用户，禁止原样或换词出现（最多可换角度，但不建议）：${avoid.join("；")}` : ""}

【输出】
JSON：{ "topics": [{ "topic": string, "angle": string, "tags": string[] }] }
- topic：选题（12-24 字）
- angle：一句话说明"为什么现在写这篇有人看"（≤30 字）
- tags：2-3 个标签（优先：前端 / 全栈 / AI / Agent / 工程）`,
    },
    {
      role: "user",
      content: JSON.stringify({
        date: today,
        section: input.section ?? "all",
        focusAreas,
        count,
        batch,
        refresh: batch > 0,
      }),
    },
  ];

  try {
    const raw = await callChat(prompt, {
      jsonMode: true,
      maxTokens: 1500,
      role: "topic-ideas",
      temperature: 0.85,
    });
    const parsed = safeParse<{
      topics?: Array<{ topic?: string; angle?: string; tags?: string[] }>;
    }>(raw, {});
    return (parsed.topics ?? [])
      .map((t) => ({
        topic: String(t.topic ?? "").trim(),
        angle: String(t.angle ?? "").trim(),
        tags: Array.isArray(t.tags)
          ? t.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 3)
          : [],
      }))
      .filter((t) => t.topic.length >= 8 && t.topic.length <= 32)
      .slice(0, count);
  } catch (error) {
    console.warn(
      "[generateHotTopics] LLM failed, caller should fallback to static seeds:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
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

/**
 * 锁定参考图 lookbook（漏洞原理那张）：
 * 暖米色纸底 + 粉/杏/薄荷/淡紫块面 + 深棕描边（背景干净，无三角/点点装饰）
 */
const DOODLE_LOOKBOOK = [
  "CRITICAL LOOKBOOK (match this reference teaching doodle exactly — colors first):",
  "Canvas background is warm latte beige paper, about #F3EBDF / #F7F0E6 — never pure white, never cool gray, never navy, never black.",
  "Subtle paper texture only — clean warm sketchbook page with NO decorative icons, NO warning triangles, NO scattered dots, NO exclamation marks in the background.",
  "All outlines are warm dark-brown ink (#4A3428), slightly wobbly hand-drawn strokes of uneven thickness — not pure black UI lines, not vector-perfect.",
  "Filled shapes use soft desaturated pastels with matte flat coloring and heavily rounded corners, plus very soft light drop shadows under cards.",
  "Signature fills: pale sky-blue panels (#C9DDF0), blush pink boxes (#F3CDD6), soft apricot/peach boxes (#F2D2B4), mint green result cards (#BFE6CB), lavender summary arrow (#C9B6E4), coral accent ribbon (#EF7B7B).",
  "Text ink is dark brown/charcoal for readability. Atmosphere is warm, friendly, educational kawaii tech comic — never cyberpunk neon, never glassmorphism, never photoreal 3D, never muddy gray wash.",
].join(" ");

/** 章节配图：手绘科普信息图 */

const SECTION_FLOW_LAYOUTS = [
  "LEFT_TO_RIGHT STORY: left cause panel → middle 1-2 mechanism boxes → right result; large summary arrow band across the bottom",
  "TOP_TITLE THREE_PANELS: short title top-left; three equal rounded panels left-to-right (before → change → after) with a bottom conclusion ribbon",
  "CAUSE_STACK_RESULT: left trigger; stacked dual flaw/step boxes in the middle; celebratory result on the right; bottom equation arrow",
  "COMPARE_THEN_PICK: two soft boxes on the left (option A vs B); arrow to a chosen path; right side shows the outcome badge",
] as const;

/** 封面：同一 lookbook，内容仍是主副标题 + 主视觉 */
const COVER_STYLE_DOODLE =
  `${DOODLE_LOOKBOOK} Cover banner 16:9 in the SAME sketchbook look. Bold Chinese headline + short keyword subtitle in dark brown ink. One large cute doodle hero metaphor matching the topic (server, browser, stopwatch, puzzle, queue, shield as simplified icons). Use blush pink / apricot / mint / lavender accents on cream-beige paper. No glass chip rows, no neon.`;

const COVER_LAYOUT_VARIANTS = [
  "LEFT_TITLE_RIGHT_HERO: bold Chinese headline + subtitle on the left third; right two-thirds shows one large hand-drawn doodle hero metaphor related to the topic",
  "BOTTOM_TITLE_CENTER_HERO: dominant cute doodle illustration centered in the upper area; bottom cream band has bold dark Chinese headline and pastel subtitle",
  "TITLE_OVER_SCENE: short bold headline near top-left; a horizontal hand-drawn scene with 1-2 soft pastel panels fills the mid canvas without extra Chinese labels",
  "DIAGONAL_SPLIT: soft peach/pink wash diagonally divides canvas; headline on the cream-beige side, doodle tech object on the pastel side",
] as const;


function pickSectionFlowLayout(sectionIndex: number): string {
  return SECTION_FLOW_LAYOUTS[sectionIndex % SECTION_FLOW_LAYOUTS.length];
}

function softClipLabel(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const chars = [...t];
  const isLatinOnly = /[A-Za-z]/.test(t) && !/[\u4e00-\u9fa5]/.test(t);
  const limit = isLatinOnly ? Math.max(maxChars, 22) : maxChars;
  if (chars.length <= limit) return t;
  if (isLatinOnly) {
    const slice = t.slice(0, limit);
    const sp = slice.lastIndexOf(" ");
    return (sp >= 4 ? slice.slice(0, sp) : slice).trim();
  }
  return chars.slice(0, limit).join("").replace(/[，,。.!！？、：:]+$/u, "").trim();
}

function normalizeStoryboard(
  raw: Partial<SectionStoryboard> | null | undefined,
  sectionHeading: string,
): SectionStoryboard | null {
  if (!raw) return null;
  const title = softClipLabel(String(raw.title ?? "").trim(), 8);
  const summary = softClipLabel(String(raw.summary ?? "").trim(), 20);
  const panelsIn = Array.isArray(raw.panels) ? raw.panels : [];
  const panels: SectionStoryPanel[] = [];
  for (const p of panelsIn) {
    if (!p || typeof p !== "object") continue;
    const label = softClipLabel(String((p as SectionStoryPanel).label ?? "").trim(), 12);
    const caption = softClipLabel(String((p as SectionStoryPanel).caption ?? "").trim(), 16);
    const visual = String((p as SectionStoryPanel).visual ?? "").trim().slice(0, 100);
    let role = String((p as SectionStoryPanel).role ?? "step") as SectionStoryPanel["role"];
    if (!["cause", "step", "flaw", "result"].includes(role)) role = "step";
    if (!label) continue;
    panels.push({ role, label, caption, visual: visual || "simple tech icon matching the label" });
    if (panels.length >= 4) break;
  }
  if (!title || panels.length < 2 || !summary) return null;
  const headingPlain = sectionHeading.replace(/<[^>]+>/g, "").trim();
  const safeTitle =
    title.length >= 2 && title !== headingPlain
      ? title
      : softClipLabel(headingPlain.split(/[：:]/)[0] || headingPlain, 8);
  return { title: safeTitle || title, panels, summary };
}

function fallbackStoryboard(sectionHeading: string, plainSection: string): SectionStoryboard {
  const heading = sectionHeading.replace(/<[^>]+>/g, "").trim();
  const title = softClipLabel(heading.split(/[：:]/)[0] || heading, 8) || "本章要点";
  const after = heading.split(/[：:]/)[1]?.trim() || "";

  // 保留英文报错短语完整
  const engPhrases = [...after.matchAll(/\b(?:other side closed|terminated|ECONNRESET|ETIMEDOUT)\b/gi)].map(
    (m) => m[0],
  );
  const zhBits = after
    .replace(/\b(?:other side closed|terminated|ECONNRESET|ETIMEDOUT)\b/gi, "")
    .split(/\s*[、,，/|＋+&]\s*|\s*(?:与|和|及|vs\.?|VS)\s*/i)
    .map((s) => softClipLabel(s.replace(/[？?].*$/, "").replace(/的实测.*$/u, "").trim(), 10))
    .filter((s) => s.length >= 2 && !/^从\d/.test(s));

  const bits = [...engPhrases, ...zhBits].slice(0, 3);

  const fromTo = heading.match(/从\s*(\d+\s*秒)\s*到\s*(\d+\s*秒)/);
  const metric = plainSection.match(/(\d+\s*秒).{0,8}(?:压到|降到|降至|到|→).{0,4}(\d+\s*秒)/);
  const summary = fromTo
    ? `${fromTo[1].replace(/\s+/g, "")}→${fromTo[2].replace(/\s+/g, "")}`
    : metric
      ? `${metric[1].replace(/\s+/g, "")}→${metric[2].replace(/\s+/g, "")}`
      : softClipLabel(bits.length >= 2 ? `${bits[0]}+${bits[1]}` : title, 20);

  const panels: SectionStoryPanel[] = [];
  if (bits.length >= 2) {
    panels.push({
      role: "cause",
      label: bits[0],
      caption: "起点",
      visual: "cute rounded icon for the starting concept",
    });
    panels.push({
      role: "step",
      label: bits[1],
      caption: "关键一步",
      visual: "middle pastel process box with simple doodle icon",
    });
    panels.push({
      role: "result",
      label: bits[2] || softClipLabel(summary, 10),
      caption: "结果",
      visual: "outcome badge or celebratory sticker",
    });
  } else {
    panels.push({
      role: "cause",
      label: "问题",
      caption: softClipLabel(heading, 14),
      visual: "broken pipe or error icon doodle in a rounded box",
    });
    panels.push({
      role: "step",
      label: "做法",
      caption: "拆解处理",
      visual: "toolbox and checklist doodle",
    });
    panels.push({
      role: "result",
      label: "效果",
      caption: summary,
      visual: "green check and speed badge",
    });
  }
  return { title, panels, summary };
}


/** 为文章章节生成配图提示词 - 手绘科普信息图：讲清本章原理/流程 */
export async function generateSectionImagePrompt(
  topic: string,
  _style: string | null,
  sectionHeading: string,
  sectionContext: string,
  options?: { sectionIndex?: number; totalSections?: number },
): Promise<string> {
  const sectionIndex = options?.sectionIndex ?? 0;
  const totalSections = options?.totalSections ?? 1;
  const layout = pickSectionFlowLayout(sectionIndex);
  const plainSection = sectionContext.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  let story: SectionStoryboard | null = null;
  try {
    const extract = await callChat(
      [
        {
          role: "system",
          content: `你是技术科普插画分镜师。根据「本章标题+正文」，提炼一张手绘教学信息图的分镜（像「漏洞原理」那种：左因→中机制→右果+底部总结箭头）。

规则：
- title：2-8 字总题（如「漏洞原理」「超时定位」「分段提效」），不要整段章节标题
- panels：2-4 个，每个含 role/label/caption/visual
  - role: cause | step | flaw | result
  - label: 2-10 字短标签（完整可读）
  - caption: 4-14 字补充说明（完整可读）
  - visual: 英文简述该格要画什么（cute icon / browser / server / arrow…）
- summary: 底部总结，最多 18 字，优先「A + B = 结论」或「425秒→105秒」这种公式感
- 内容必须忠于本章正文，禁止编造本章没有的漏洞/报错/数字
- 不要输出长句子；所有中文都要短而完整，避免生图截断

Output JSON only:
{ "title": string, "panels": [{ "role": string, "label": string, "caption": string, "visual": string }], "summary": string }`,
        },
        {
          role: "user",
          content: JSON.stringify({
            articleTopic: topic,
            sectionHeading,
            sectionContent: plainSection.slice(0, 1800),
            preferredLayout: layout,
          }),
        },
      ],
      { jsonMode: true, maxTokens: 420, role: "section-image" },
    );
    story = normalizeStoryboard(safeParse<Partial<SectionStoryboard>>(extract, {}), sectionHeading);
  } catch {
    story = null;
  }

  if (!story) story = fallbackStoryboard(sectionHeading, plainSection);
  return buildInfographicPrompt(story, layout, sectionIndex, totalSections);
}

/** 从正文/摘要本地提炼短关键词（无 LLM 时的兜底） */
function extractLocalKeywords(corpus: string, limit = 4): string[] {
  const text = corpus.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const candidates: string[] = [];
  const push = (raw: string) => {
    const t = raw.replace(/[《》【】\[\]（）()「」""'']/g, "").trim();
    if (t.length >= 2 && t.length <= 8 && !isWeakCoverSubtitle(t)) candidates.push(t);
  };

  // 英文/数字技术词
  for (const m of text.matchAll(/\b(?:API|LLM|HTTP|Node\.?js|Claude|Cursor|timeout|gateway|\d+\s*秒|\d+\s*ms)\b/gi)) {
    push(m[0].replace(/\s+/g, ""));
  }
  // 中文技术短语（简单词典 + 标题分片）
  const dict = [
    "网关超时", "分段生成", "受限并发", "单章降级", "跳过精炼", "封面并行",
    "环境配置", "提示词", "多文件编辑", "代码地图", "单元测试", "重构",
    "权限校验", "加密传输", "全栈安全", "实战手册", "开发者工具",
  ];
  for (const w of dict) {
    if (text.includes(w)) push(w);
  }
  for (const part of text.split(/[，,。！？；、：:\s\/|—–·]+/)) {
    if (part.length >= 3 && part.length <= 6) push(part);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of candidates) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= limit) break;
  }
  return out;
}

const WEAK_COVER_SUBTITLE_BLOCKLIST = [
  "大纲正常",
  "正文失败",
  "正文正常",
  "生成成功",
  "生成失败",
  "生成正常",
  "标题正常",
  "封面失败",
];

function isWeakCoverSubtitle(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 14) return true;
  if (isSectionHeadingLike(t)) return true;
  // 状态短句 / 无信息量碎片，不能当封面副标题
  if (WEAK_COVER_SUBTITLE_BLOCKLIST.includes(t)) return true;
  if (/^(大纲|正文|标题|封面|摘要)?(正常|失败|成功|完成|报错|超时)?$/.test(t)) return true;
  if (/^(正常|失败|成功|完成|报错|可以|不行|没有|就是)$/.test(t)) return true;
  if (/^(API|LLM|HTTP|CSS|JS)$/i.test(t)) return true;
  return false;
}

/** 最终兜底：副标题绝不能是弱句；优先标题后半段 / 关键词拼接 */
function assertSafeCoverSubtitle(
  candidate: string,
  keywords: string[],
  title: string,
): string {
  if (candidate && !isWeakCoverSubtitle(candidate)) return candidate;

  const splitMatch = title.replace(/[《》【】\[\]（）()「」""'']/g, "").trim().match(/^(.+?[？?：:])(.+)$/);
  if (splitMatch) {
    const right = fitCoverPhrase(splitMatch[2].trim(), 14);
    if (right && !isWeakCoverSubtitle(right)) return right;
  }

  const fromKeywords = keywords.filter((k) => !isWeakCoverSubtitle(k));
  if (fromKeywords.length >= 2) {
    return fitCoverPhrase(fromKeywords.slice(0, 2).join(" · "), 14) || fromKeywords[0];
  }
  if (fromKeywords[0]) return fromKeywords[0];
  return "实战指南";
}

/** 仅接受已完整且够短的短语；过长且无法自然断句则放弃，绝不硬截中文 */
function fitCoverPhrase(text: string, maxLen: number): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= maxLen) return cleaned;

  // 英文：可在空格处截断
  if (/[A-Za-z]/.test(cleaned) && cleaned.includes(" ")) {
    const slice = cleaned.slice(0, maxLen);
    if (/[A-Za-z0-9]$/.test(slice) && /[A-Za-z0-9]/.test(cleaned[maxLen] ?? "")) {
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace >= Math.floor(maxLen * 0.5)) {
        const cut = slice.slice(0, lastSpace).trim();
        return cut.length >= 4 ? cut : null;
      }
      return null;
    }
    const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("·"));
    if (breakAt >= Math.floor(maxLen * 0.5)) {
      const cut = slice.slice(0, breakAt).trim();
      return cut.length >= 4 ? cut : null;
    }
  }

  // 中文：绝不硬截，宁可不用
  return null;
}

function isSectionHeadingLike(text: string): boolean {
  return /^(开篇|核心|第[一二三四五六七八九十\d]+|写在最后|总结|引言|前言|结尾)/.test(text)
    || /[？?]$/.test(text)
    || text.includes("：")
    || text.includes(":");
}

/**
 * 封面主副标题：
 * - 主标题用文章标题（可按？/：拆分）
 * - 副标题用正文关键词总结，禁止摘抄「大纲正常」这类无信息短句
 */
function deriveCoverTitleLines(
  title: string,
  summary?: string | null,
  topic?: string | null,
): { headline: string; subtitle: string; keywords: string[] } {
  const cleanedTitle = title.replace(/[《》【】\[\]（）()「」""'']/g, "").trim();
  const corpus = `${topic ?? ""} ${cleanedTitle} ${summary ?? ""}`;
  const keywords = extractLocalKeywords(corpus, 4);

  // 标题含冒号 / 问号：前半主标题，后半若合格可作副标题
  const splitMatch = cleanedTitle.match(/^(.+?[？?：:])(.+)$/);
  if (splitMatch) {
    const left = fitCoverPhrase(splitMatch[1].replace(/[：:]$/, "？").trim(), 22);
    const right = fitCoverPhrase(splitMatch[2].trim(), 14);
    if (left && right && !isWeakCoverSubtitle(right)) {
      return { headline: left, subtitle: right, keywords };
    }
    if (left) {
      const tag = keywords.length >= 2
        ? keywords.slice(0, 2).join(" · ")
        : keywords[0] || "实战指南";
      return { headline: left, subtitle: fitCoverPhrase(tag, 14) || "实战指南", keywords };
    }
  }

  const headline = fitCoverPhrase(cleanedTitle, 22) || cleanedTitle.slice(0, 22) || "技术专题";
  const tag =
    keywords.length >= 2
      ? keywords.slice(0, 2).join(" · ")
      : keywords[0] || "实战指南";
  const subtitle = fitCoverPhrase(tag, 14) || "实战指南";
  return { headline, subtitle, keywords };
}

const LIGHT_COVER_TOPIC_RE =
  /前端|ui|ux|设计|v0|tauri|组件|样式|css|面试|轻量|桌面|tsx|react|vue|svelte|tailwind|动效|布局/i;

function pickCoverTheme(topic: string, title: string): "warm" | "cool" {
  const corpus = `${topic}${title}`;
  // 仍按主题微调冷暖，但都走手绘奶油纸风，不再出深色霓虹封面
  if (LIGHT_COVER_TOPIC_RE.test(corpus)) return "cool";
  return "warm";
}

function pickCoverVisualVariant(topic: string, title: string) {
  let hash = 0;
  for (let i = 0; i < topic.length; i++) hash = (hash + topic.charCodeAt(i)) | 0;
  const layout = COVER_LAYOUT_VARIANTS[Math.abs(hash) % COVER_LAYOUT_VARIANTS.length];
  const theme = pickCoverTheme(topic, title);
  // 冷暖只微调强调色，背景始终锁死参考图的拿铁米色纸
  const tint =
    theme === "cool"
      ? "Lean accents slightly toward pale sky-blue and lilac, still on latte-beige paper."
      : "Lean accents slightly toward blush pink and apricot, still on latte-beige paper.";
  const styleAnchor = `${COVER_STYLE_DOODLE} ${tint}`;
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
  const derived = deriveCoverTitleLines(title, context?.summary, topic);
  const { headline, keywords: seedKeywords } = derived;
  let subtitle = derived.subtitle;
  const variant = pickCoverVisualVariant(topic, title);
  const domainHint = coverDomainHint(topic);
  const contentExcerpt = (context?.contentExcerpt ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  // 摘要里的「大纲正常」会诱导模型当副标题，送进 LLM 前先抹掉
  const safeSummary = WEAK_COVER_SUBTITLE_BLOCKLIST.reduce(
    (s, weak) => s.split(weak).join(""),
    context?.summary || "",
  ).replace(/[，,]{2,}/g, "，").trim();
  const safeExcerpt = WEAK_COVER_SUBTITLE_BLOCKLIST.reduce(
    (s, weak) => s.split(weak).join(""),
    contentExcerpt,
  );

  const prompt = await callChat([
    {
      role: "system",
      content: IMAGE_PROMPT_SYSTEM + `\n\nCreate a WeChat article COVER banner (16:9) in the SAME hand-drawn educational doodle style as teaching infographics (cream paper, pastel panels, cute simplified icons). Content stays a cover: bold Chinese headline + one short keyword tagline + one hero doodle — NOT a multi-panel vulnerability storyboard.

STYLE ANCHOR (fixed for this cover):
${variant.styleAnchor}

LAYOUT (use exactly this composition):
${variant.layout}

TOPIC VISUALS:
- Domain: ${domainHint}
- Pick ONE large hand-drawn doodle hero metaphor that fits the article (cute server, browser window, stopwatch, queue boxes, puzzle pieces, shield outline — flat pastel, not 3D render)
- Tiny floating doodle badges OK for decoration — icons only, no extra Chinese labels

SUBTITLE = KEYWORD SUMMARY (mandatory):
- Read title/summary/content and extract the article's core keywords (tools, errors, methods, metrics)
- Compress into ONE punchy Chinese tagline of 6-14 characters, e.g. 「网关超时 · 五步提效」「425秒压到105秒」
- Seed keywords for reference: ${JSON.stringify(seedKeywords)}
- FORBIDDEN as subtitle: status fragments like 「大纲正常」「正文失败」「生成成功」; chapter headings; truncated mid-phrases

TEXT RULES (critical):
- The ONLY Chinese text on the image: headline 「${headline}」 and your final subtitle tagline
- Headline: large, bold, dark charcoal ink — copy 「${headline}」 EXACTLY
- Subtitle: smaller pastel or charcoal keyword tagline — never truncate
- NEVER paint outline/section headings (开篇/核心/第N章)
- NEVER use a horizontal row of frosted glass keyword chips at the bottom
- NEVER paint the raw articleTopic as a corner watermark
- BACKGROUND must be warm cream / off-white paper, bright and clean — not navy cyber, not muddy gray

Output JSON: { "prompt": string, "subtitle": string, "keywords": string[] }
- "subtitle": the final 6-14 char keyword tagline
- "keywords": 3-5 short keywords extracted from the article content
- In "prompt": describe visuals in English; Chinese text must match headline + subtitle exactly.`,
    },
    {
      role: "user",
      content: JSON.stringify({
        domainHint,
        theme: variant.theme,
        layoutVariant: variant.layout,
        headline,
        preferredSubtitle: subtitle,
        seedKeywords,
        contextForMeaningOnly: {
          articleTopic: topic,
          articleTitle: title,
          summary: safeSummary,
          outlineHeadingsDoNotPaint: keyPoints,
          contentExcerpt: safeExcerpt || undefined,
        },
        doNotPaintTheseStrings: [
          topic,
          ...keyPoints,
          ...WEAK_COVER_SUBTITLE_BLOCKLIST,
        ].filter((s) => s && s !== headline && s !== subtitle),
      }),
    },
  ], { jsonMode: true, maxTokens: 520, role: "cover-prompt" });

  const parsed = safeParse<{ prompt?: string; subtitle?: string; keywords?: string[] }>(prompt, {});
  const llmSubtitle = typeof parsed.subtitle === "string" ? parsed.subtitle.trim() : "";
  if (llmSubtitle && !isWeakCoverSubtitle(llmSubtitle) && llmSubtitle.length <= 14) {
    subtitle = llmSubtitle;
  }
  const llmKeywords = (parsed.keywords ?? [])
    .map((k) => String(k).replace(/\s+/g, "").trim())
    .filter((k) => k.length >= 2 && k.length <= 8 && !isWeakCoverSubtitle(k))
    .slice(0, 5);
  const finalKeywords = llmKeywords.length >= 2 ? llmKeywords : seedKeywords.filter((k) => !isWeakCoverSubtitle(k));

  subtitle = assertSafeCoverSubtitle(subtitle, finalKeywords, title);

  const forbidden = [
    ...keyPoints,
    ...WEAK_COVER_SUBTITLE_BLOCKLIST,
  ];

  if (parsed.prompt) {
    return reinforceCoverPrompt(parsed.prompt, headline, subtitle, variant, forbidden);
  }

  return reinforceCoverPrompt(
    `${variant.styleAnchor} ${variant.layout}. ` +
      `Bold Chinese headline 「${headline}」 with keyword subtitle 「${subtitle}」. ` +
      `Keywords: ${finalKeywords.join(", ")}. ` +
      `One large hand-drawn pastel doodle hero about ${domainHint}. ` +
      `Cream paper background. No keyword chip row. No chapter headings.`,
    headline,
    subtitle,
    variant,
    forbidden,
  );
}

/** 追加封面约束：强制精确主副标题， scrub 弱句与章节标题残留 */
function reinforceCoverPrompt(
  prompt: string,
  headline: string,
  subtitle: string,
  variant: ReturnType<typeof pickCoverVisualVariant>,
  forbiddenExtra: string[] = [],
): string {
  // 再保险：reinforce 入口绝不放行弱副标题
  const safeSubtitle = isWeakCoverSubtitle(subtitle) ? "实战指南" : subtitle;
  let cleaned = prompt.trim();

  // 强制改写所有 subtitle / 副标题引文
  cleaned = cleaned
    .replace(/(subtitle|副标题)[^「'"]{0,40}[「'"][^」'"]+[」'"]/gi, `subtitle 「${safeSubtitle}」`)
    .replace(/smaller subtitle [「'"][^」'"]+[」'"]/gi, `smaller subtitle 「${safeSubtitle}」`)
    .replace(/with subtitle [「'"][^」'"]+[」'"]/gi, `with subtitle 「${safeSubtitle}」`);

  // 无论从哪漏进来，直接抹掉弱句
  for (const weak of WEAK_COVER_SUBTITLE_BLOCKLIST) {
    cleaned = cleaned.split(weak).join(safeSubtitle);
  }

  for (const bad of forbiddenExtra) {
    const t = bad?.trim();
    if (!t || t.length < 4) continue;
    if (t === headline || t === safeSubtitle) continue;
    if (WEAK_COVER_SUBTITLE_BLOCKLIST.includes(t)) continue; // 已处理
    cleaned = cleaned.split(t).join("the article theme");
    if (t.length >= 8) {
      const prefix = t.slice(0, 12);
      if (cleaned.includes(prefix)) {
        cleaned = cleaned.split(prefix).join("");
      }
    }
  }

  // 丢掉摘要原文，避免模型再抄「大纲正常」——只保留最终要画的字
  const hints = [
    variant.styleAnchor,
    `Layout: ${variant.layout}.`,
    `Headline text must be exactly 「${headline}」 — large, bold, complete. Never truncate.`,
    `Subtitle text must be exactly 「${safeSubtitle}」 — keyword tagline. Never use 大纲正常 or other status fragments.`,
    `The ONLY Chinese strings allowed on the image are 「${headline}」 and 「${safeSubtitle}」.`,
    "All on-image text must be complete phrases — never cut off Chinese or English mid-word.",
    "BACKGROUND: warm latte beige paper (#F3EBDF), subtle paper grain only — clean empty space, no warning triangles, no scattered dots. Pastel blush/apricot/mint/lavender accents, brown doodle outlines.",
    "FORBIDDEN: 大纲正常、正文失败、生成成功, and any chapter headings.",
    "FORBIDDEN: horizontal row of 3-4 small glass cards with keyword labels at the bottom.",
    "FORBIDDEN: pure white studio bg, cool gray wash, dark navy cyber backgrounds, neon glow, photoreal 3D renders, glassmorphism.",
    "FORBIDDEN: text in top-left or top-right corners as watermarks.",
    "No photoreal faces. Cute simplified doodle icons OK. No cluttered chip/tag rows.",
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
