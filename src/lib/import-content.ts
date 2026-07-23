import { enforceArticleHtmlFormat, normalizeArticleMarkup } from "@/lib/wechat-style";

export const IMPORT_CONTENT_MAX_CHARS = 80_000;

export class ImportContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportContentError";
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

/** Heuristic: enough real tags that this is already HTML, not prose mentioning angle brackets. */
export function looksLikeHtml(input: string): boolean {
  const sample = input.trim().slice(0, 4000);
  if (!sample) return false;
  const tagMatches = sample.match(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g);
  return Boolean(tagMatches && tagMatches.length >= 2);
}

function flushParagraph(buffer: string[], parts: string[]) {
  const text = buffer.join("\n").trim();
  buffer.length = 0;
  if (!text) return;
  parts.push(`<p>${applyInlineMarkdown(text).replace(/\n/g, "<br />")}</p>`);
}

function flushList(items: string[], ordered: boolean, parts: string[]) {
  if (items.length === 0) return;
  const tag = ordered ? "ol" : "ul";
  const lis = items.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join("");
  parts.push(`<${tag}>${lis}</${tag}>`);
  items.length = 0;
}

/** Convert plain text / light Markdown into article HTML. */
export function markdownOrPlainToHtml(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  const paraBuf: string[] = [];
  const listItems: string[] = [];
  let listOrdered: boolean | null = null;
  let inFence = false;
  let fenceLang = "";
  const fenceLines: string[] = [];

  const endList = () => {
    if (listOrdered === null) return;
    flushList(listItems, listOrdered, parts);
    listOrdered = null;
  };

  const endFence = () => {
    if (!inFence) return;
    const code = escapeHtml(fenceLines.join("\n"));
    const langClass = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : "";
    parts.push(`<pre><code${langClass}>${code}</code></pre>`);
    fenceLines.length = 0;
    fenceLang = "";
    inFence = false;
  };

  for (const line of lines) {
    const fenceOpen = /^```([\w+-]*)\s*$/.exec(line.trim());
    if (fenceOpen) {
      if (inFence) {
        endFence();
      } else {
        endList();
        flushParagraph(paraBuf, parts);
        inFence = true;
        fenceLang = fenceOpen[1] || "";
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      endList();
      flushParagraph(paraBuf, parts);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      endList();
      flushParagraph(paraBuf, parts);
      const level = heading[1].length;
      const tag = level === 1 ? "h2" : level === 2 ? "h2" : "h3";
      parts.push(`<${tag}>${applyInlineMarkdown(heading[2].trim())}</${tag}>`);
      continue;
    }

    const ul = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (ul) {
      flushParagraph(paraBuf, parts);
      if (listOrdered !== false) {
        endList();
        listOrdered = false;
      }
      listItems.push(ul[1].trim());
      continue;
    }

    const ol = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (ol) {
      flushParagraph(paraBuf, parts);
      if (listOrdered !== true) {
        endList();
        listOrdered = true;
      }
      listItems.push(ol[1].trim());
      continue;
    }

    endList();
    paraBuf.push(trimmed);
  }

  endFence();
  endList();
  flushParagraph(paraBuf, parts);

  return parts.join("\n") || "<p></p>";
}

export function plainTextLengthFromHtml(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Normalize pasted import body into platform HTML.
 * - HTML-like input → existing wechat cleanup pipeline
 * - Otherwise → light Markdown / plain text → HTML
 */
export function convertImportedContent(raw: string): { html: string; wordCount: number } {
  const text = raw.trim();
  if (!text) {
    throw new ImportContentError("请粘贴正文内容");
  }
  if (text.length > IMPORT_CONTENT_MAX_CHARS) {
    throw new ImportContentError(`正文过长，请控制在 ${IMPORT_CONTENT_MAX_CHARS} 字以内`);
  }

  const html = looksLikeHtml(text)
    ? enforceArticleHtmlFormat(normalizeArticleMarkup(text))
    : markdownOrPlainToHtml(text);

  const cleaned = html.trim();
  if (!cleaned || plainTextLengthFromHtml(cleaned) === 0) {
    throw new ImportContentError("正文转换后为空，请检查粘贴内容");
  }

  return {
    html: cleaned,
    wordCount: plainTextLengthFromHtml(cleaned),
  };
}
