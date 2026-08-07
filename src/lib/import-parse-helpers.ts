/** 导入解析的轻量工具（可安全在客户端引用，勿依赖 wechat-style） */

export const IMPORT_CONTENT_MAX_CHARS = 160_000;
export const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
export const IMPORT_FILE_EXTENSIONS = [".md", ".markdown", ".txt", ".html", ".htm"] as const;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

/** Heuristic: enough real tags that this is already HTML, not prose mentioning angle brackets. */
export function looksLikeHtml(input: string): boolean {
  const sample = input.trim().slice(0, 4000);
  if (!sample) return false;
  const tagMatches = sample.match(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g);
  return Boolean(tagMatches && tagMatches.length >= 2);
}

/** 从正文里猜标题：Markdown # / HTML <h1> / 首行短句 */
export function extractTitleFromContent(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const md = text.match(/^#{1,2}\s+(.+)$/m);
  if (md?.[1]) {
    const t = md[1].replace(/[#*_`]/g, "").trim();
    if (t.length >= 2 && t.length <= 80) return t.slice(0, 80);
  }

  if (looksLikeHtml(text)) {
    const h1 = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    if (h1) {
      const t = decodeEntities(h1.replace(/<[^>]+>/g, "")).trim();
      if (t.length >= 2 && t.length <= 80) return t.slice(0, 80);
    }
  }

  const firstLine = text
    .split(/\n+/)
    .map((l) => l.trim())
    .find((l) => l && !/^```/.test(l));
  if (firstLine && firstLine.length >= 4 && firstLine.length <= 40 && !looksLikeHtml(firstLine)) {
    return firstLine.replace(/^#+\s*/, "").slice(0, 80);
  }

  return null;
}

export function isSupportedImportFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return IMPORT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
