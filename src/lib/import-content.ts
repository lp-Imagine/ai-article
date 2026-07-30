import { enforceArticleHtmlFormat, normalizeArticleMarkup } from "@/lib/wechat-style";
import {
  extractTitleFromContent,
  IMPORT_CONTENT_MAX_CHARS,
  IMPORT_FILE_EXTENSIONS,
  isSupportedImportFilename,
  looksLikeHtml,
} from "@/lib/import-parse-helpers";

export {
  extractTitleFromContent,
  IMPORT_CONTENT_MAX_CHARS,
  IMPORT_FILE_EXTENSIONS,
  isSupportedImportFilename,
  looksLikeHtml,
};

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

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function applyInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
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
export function convertImportedContent(raw: string): {
  html: string;
  wordCount: number;
  /** html = 已走本地 HTML 规范化；text = 纯文本/Markdown 转换 */
  sourceKind: "html" | "text";
} {
  const text = raw.trim();
  if (!text) {
    throw new ImportContentError("请粘贴正文内容");
  }
  if (text.length > IMPORT_CONTENT_MAX_CHARS) {
    throw new ImportContentError(`正文过长，请控制在 ${IMPORT_CONTENT_MAX_CHARS} 字以内`);
  }

  const sourceKind = looksLikeHtml(text) ? "html" : "text";
  let htmlInput = text;
  if (sourceKind === "html" && /<html[\s>]/i.test(text)) {
    try {
      htmlInput = extractArticleFromHtmlPage(text).content;
    } catch {
      htmlInput = text;
    }
  }
  const html =
    sourceKind === "html"
      ? enforceArticleHtmlFormat(normalizeArticleMarkup(htmlInput))
      : markdownOrPlainToHtml(text);

  const cleaned = html.trim();
  if (!cleaned || plainTextLengthFromHtml(cleaned) === 0) {
    throw new ImportContentError("正文转换后为空，请检查粘贴内容");
  }

  return {
    html: cleaned,
    wordCount: plainTextLengthFromHtml(cleaned),
    sourceKind,
  };
}

/** 去掉脚本/样式等噪声，抽取网页正文片段 */
export function extractArticleFromHtmlPage(
  html: string,
  opts?: { url?: string },
): { title: string; content: string; summary: string | null } {
  const raw = html.replace(/\r\n/g, "\n");
  if (!raw.trim()) {
    throw new ImportContentError("网页内容为空");
  }

  let title =
    metaContent(raw, "og:title") ||
    metaContent(raw, "twitter:title") ||
    matchTagText(raw, "title") ||
    matchTagText(raw, "h1") ||
    "";
  title = decodeEntities(title).replace(/\s+/g, " ").trim().slice(0, 120);
  // 多数 CMS / 静态站会把站点名拼到 <title> 末尾（"文章标题 | 站点名"），
  // 这里剥离末尾的 ` | xxx` 后缀，避免与正文中重复的首 H1 叠加。
  title = title.replace(/\s*[\|｜]\s*[^\|｜]+$/, "").trim();

  const summary =
    metaContent(raw, "og:description") ||
    metaContent(raw, "description") ||
    metaContent(raw, "twitter:description");
  const cleanSummary = summary
    ? decodeEntities(summary).replace(/\s+/g, " ").trim().slice(0, 500)
    : null;

  // 优先常见正文容器
  const candidates = [
    extractById(raw, "js_content"), // 微信公众号
    extractByClass(raw, "rich_media_content"),
    extractByTag(raw, "article"),
    extractByAttr(raw, "role", "main"),
    extractByTag(raw, "main"),
    extractByClass(raw, "vp-doc"), // VitePress 文档正文
    extractByClass(raw, "post-content"),
    extractByClass(raw, "article-content"),
    extractByClass(raw, "entry-content"),
    extractById(raw, "content"),
  ].filter(Boolean) as string[];

  let bodyHtml = candidates.find((c) => plainTextLengthFromHtml(c) >= 80) ?? "";
  if (!bodyHtml) {
    // 退化：取 body 内文本块
    const body = extractByTag(raw, "body") || raw;
    bodyHtml = stripChrome(body);
  }

  bodyHtml = stripChrome(bodyHtml);
  if (plainTextLengthFromHtml(bodyHtml) < 40) {
    throw new ImportContentError(
      opts?.url
        ? "未能从该网页提取到足够正文，请改用粘贴或上传文件"
        : "未能提取到足够正文",
    );
  }

  if (!title) {
    title = extractTitleFromContent(bodyHtml) || "未命名文章";
  }

  return {
    title,
    content: stripDuplicateFirstH1(bodyHtml.trim(), title),
    summary: cleanSummary,
  };
}

/**
 * 若 bodyHtml 中第一个 <h1> 的纯文本与 title 相同，则移除该 H1。
 * 避免预览组件同时渲染 props.title 和正文首 H1 造成的视觉重复
 * （常见于 VitePress / 多数 CMS 页面：frontmatter title 渲染成 H1，
 *  而页面 <title> 标签又拼接了站点名，导致两处标题并列出现）。
 */
function stripDuplicateFirstH1(html: string, title: string): string {
  if (!title) return html;
  // 同时 normalize 零宽空格 / BOM 等不可见字符（VitePress 的 header-anchor
  // 链接会带 \u200B），避免因不可见字符导致首 H1 与 title 判等失败。
  const normalize = (s: string) =>
    s.replace(/[\s\u200B-\u200D\uFEFF]/g, "").toLowerCase();
  const normalizedTitle = normalize(title);
  const h1Re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;
  const m = h1Re.exec(html);
  if (!m) return html;
  const innerText = normalize(m[1].replace(/<[^>]+>/g, ""));
  if (innerText === normalizedTitle) {
    return html.slice(0, m.index) + html.slice(m.index + m[0].length);
  }
  return html;
}

function metaContent(html: string, name: string): string {
  const prop = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
  )?.[1];
  if (prop) return prop;
  const alt = html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
      "i",
    ),
  )?.[1];
  return alt ?? "";
}

function matchTagText(html: string, tag: string): string {
  const block = extractByTag(html, tag);
  return block ? block.replace(/<[^>]+>/g, "").trim() : "";
}

function isSelfClosingOpenTag(openTag: string): boolean {
  return /\/\s*>$/.test(openTag.trim());
}

/** 从 openTagEnd（开标签 `>` 之后）起，找到与之配对的闭合标签位置 */
function findBalancedTagEnd(html: string, tag: string, openTagEnd: number): number {
  let depth = 1;
  let pos = openTagEnd;
  const openRe = new RegExp(`<${tag}\\b`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");

  while (depth > 0 && pos < html.length) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const openM = openRe.exec(html);
    const closeM = closeRe.exec(html);
    if (!closeM) return -1;

    if (openM && openM.index < closeM.index) {
      const gt = html.indexOf(">", openM.index);
      if (gt === -1) return -1;
      const openTag = html.slice(openM.index, gt + 1);
      if (!isSelfClosingOpenTag(openTag)) depth += 1;
      pos = gt + 1;
      continue;
    }

    depth -= 1;
    if (depth === 0) return closeM.index + closeM[0].length;
    pos = closeM.index + closeM[0].length;
  }

  return -1;
}

function extractByTag(html: string, tag: string): string | null {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "i");
  const openM = openRe.exec(html);
  if (!openM || openM.index === undefined) return null;
  const openStart = openM.index;
  const openEnd = html.indexOf(">", openStart) + 1;
  if (openEnd === 0) return null;
  const end = findBalancedTagEnd(html, tag.toLowerCase(), openEnd);
  if (end === -1) return null;
  return html.slice(openStart, end);
}

function extractById(html: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRe = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid=["']${escaped}["'][^>]*>`, "i");
  const openM = openRe.exec(html);
  if (!openM || openM.index === undefined) return null;
  const tag = openM[1].toLowerCase();
  const openStart = openM.index;
  const openEnd = html.indexOf(">", openStart) + 1;
  if (openEnd === 0) return null;
  const end = findBalancedTagEnd(html, tag, openEnd);
  if (end === -1) return null;
  return html.slice(openStart, end);
}

function extractByClass(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classRe = new RegExp(`\\bclass=["'][^"']*\\b${escaped}\\b[^"']*["']`, "i");
  const openTagRe = /<([a-z0-9]+)\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openTagRe.exec(html)) !== null) {
    const openTag = match[0];
    if (!classRe.test(openTag)) continue;
    const tag = match[1].toLowerCase();
    const openStart = match.index;
    const openEnd = openStart + openTag.length;
    const end = findBalancedTagEnd(html, tag, openEnd);
    if (end === -1) continue;
    return html.slice(openStart, end);
  }

  return null;
}

function extractByAttr(html: string, attr: string, value: string): string | null {
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrRe = new RegExp(`\\b${escapedAttr}=["']${escapedValue}["']`, "i");
  const openTagRe = /<([a-z0-9]+)\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openTagRe.exec(html)) !== null) {
    const openTag = match[0];
    if (!attrRe.test(openTag)) continue;
    const tag = match[1].toLowerCase();
    const openStart = match.index;
    const openEnd = openStart + openTag.length;
    const end = findBalancedTagEnd(html, tag, openEnd);
    if (end === -1) continue;
    return html.slice(openStart, end);
  }

  return null;
}

const PRESERVE_BLOCK_RE = /<(pre|code|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi;

function maskHtmlBlocks(html: string): { masked: string; blocks: string[] } {
  const blocks: string[] = [];
  const masked = html.replace(PRESERVE_BLOCK_RE, (block) => {
    const token = `__IMP_PRESERVE_${blocks.length}__`;
    blocks.push(block);
    return token;
  });
  return { masked, blocks };
}

function unmaskHtmlBlocks(masked: string, blocks: string[]): string {
  let out = masked;
  for (let i = 0; i < blocks.length; i++) {
    const token = `__IMP_PRESERVE_${i}__`;
    out = out.replace(token, blocks[i]);
  }
  return out;
}

function stripChromeBlocks(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(nav|header|footer|aside|iframe|svg|form)\b[\s\S]*?<\/\1>/gi, "");
}

/**
 * 移除 Shiki 语法高亮产生的内联 span（style 含 --shiki-light / --shiki-dark）。
 * 这些 span 仅承担颜色信息，对正文无语义价值；嵌套多层会让代码块体积膨胀数倍，
 * 导致导入长文时被 IMPORT_CONTENT_MAX_CHARS 截断。循环以展开嵌套。
 */
function stripShikiSpans(html: string): string {
  let prev: string;
  let cur = html;
  do {
    prev = cur;
    cur = cur.replace(
      /<span\b[^>]*style="[^"]*--shiki-(?:light|dark)[^"]*"[^>]*>([\s\S]*?)<\/span>/g,
      "$1",
    );
  } while (cur !== prev);
  return cur;
}

function stripChrome(html: string): string {
  // 先清理 Shiki 高亮 span（含 pre/code 内部），避免代码块膨胀导致导入截断
  const unshinked = stripShikiSpans(html);
  const { masked, blocks } = maskHtmlBlocks(unshinked);
  return unmaskHtmlBlocks(stripChromeBlocks(masked), blocks).trim();
}

/** 校验可抓取的公开 URL，防止 SSRF */
export function assertSafeImportUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportContentError("请输入有效的网页链接");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportContentError("仅支持 http / https 链接");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new ImportContentError("不允许抓取本地或内网地址");
  }
  // 私有 IP / 链路本地
  if (
    /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith("fc00:") ||
    host.startsWith("fe80:")
  ) {
    throw new ImportContentError("不允许抓取内网地址");
  }
  return url;
}
