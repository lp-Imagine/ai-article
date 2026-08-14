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
