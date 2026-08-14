/**
 * 从 LLM 回复里抽出 HTML。JSON 模式被 max_tokens 截断时，
 * 标准 JSON.parse 会失败，需要从半截字符串里抢救已写出的正文。
 */

const HTML_FIELD_KEYS = ["sectionHtml", "content", "html", "section", "openingHtml", "opening"] as const;

export function extractHtmlFromLlmJson(
  parsed: Record<string, unknown>,
  keys: readonly string[] = HTML_FIELD_KEYS,
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
export function extractHtmlFromPlainReply(raw: string): string {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const firstTag = body.search(/<(h2|p|ul|ol|pre|blockquote|div)\b/i);
  return firstTag > 0 ? body.slice(firstTag).trim() : body;
}

/**
 * JSON 在字符串字段中途被截断时，把已写出的 HTML 抢救出来。
 * 例如：{"sectionHtml": "<h2>标题</h2><p>…未闭合
 */
export function salvageTruncatedJsonHtml(
  raw: string,
  keys: readonly string[] = HTML_FIELD_KEYS,
): string {
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"`);
    const match = raw.match(re);
    if (!match || match.index == null) continue;
    const start = match.index + match[0].length;
    let out = "";
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === "\\" && i + 1 < raw.length) {
        const next = raw[i + 1];
        const escaped: Record<string, string> = {
          n: "\n",
          t: "\t",
          r: "\r",
          '"': '"',
          "\\": "\\",
        };
        out += escaped[next] ?? next;
        i += 1;
        continue;
      }
      if (ch === '"') break;
      out += ch;
    }
    const trimmed = out.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

/** json 模式优先解析；失败或字段为空时抢救截断 JSON，再退回纯 HTML。 */
export function extractSectionHtml(raw: string, jsonMode: boolean): string {
  if (!raw.trim()) return "";
  if (jsonMode) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const html = extractHtmlFromLlmJson(parsed);
      if (html.length >= 60) return html;
    } catch {
      // 截断 JSON，走抢救
    }
    const salvaged = salvageTruncatedJsonHtml(raw);
    if (salvaged.length >= 60) return salvaged;
  }
  return extractHtmlFromPlainReply(raw);
}

/** 会出现在正文里的块级标签（未闭合即视为半截） */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "blockquote",
  "pre",
  "section",
  "figure",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "dl",
  "dt",
  "dd",
  "details",
  "summary",
]);

/** HTML 空元素：无闭合标签是合法的，跳过 */
const VOID_TAGS = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "source",
  "wbr",
  "area",
  "base",
  "col",
  "embed",
  "track",
]);

/**
 * 检测 HTML 片段是否被截断：存在未闭合的块级标签。
 * 模型在 max_tokens 截断时常停在半句话（如 `<p>…前300字是`），
 * 这类半截内容不能当完整章节发布，应判定为截断交给重试逻辑。
 * 兼容：属性值里的 `>`、自闭合 `<br/>`、空元素 `<img>` 等。
 */
export function isTruncatedHtmlFragment(html: string): boolean {
  if (!html) return false;
  const stack: string[] = [];
  // 引号内的属性值（可含 >）优先匹配；标签名后可选属性；可选自闭合斜杠
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:"[^"]*"|'[^']*'|[^>"'])*\s*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const full = m[0];
    const name = m[1].toLowerCase();
    if (VOID_TAGS.has(name)) continue;
    if (full.startsWith("</")) {
      const idx = stack.lastIndexOf(name);
      if (idx >= 0) stack.splice(idx); // 闭合它（及其内部未闭合的标签）
    } else if (!full.endsWith("/>")) {
      stack.push(name);
    }
  }
  return stack.length > 0;
}
