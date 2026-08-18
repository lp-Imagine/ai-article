/**
 * 代码语法高亮工具
 *
 * 基于 highlight.js，将 <pre><code> 代码块转换为「微信公众号兼容」的高亮 HTML。
 * 输出结构为嵌套 <section>，完全靠内联样式，不依赖任何 class / pseudo / position。
 */

import hljs from "highlight.js";

/** GitHub Dark 配色 → 内联样式映射 */
const TOKEN_STYLES: Record<string, string> = {
  "hljs-keyword": "color:#ff7b72;font-weight:600;",
  "hljs-string": "color:#a5d6ff;",
  "hljs-number": "color:#79c0ff;",
  "hljs-comment": "color:#8b949e;font-style:italic;",
  "hljs-title function_": "color:#d2a8ff;",
  "hljs-title class_": "color:#ffa657;font-weight:700;",
  "hljs-title": "color:#d2a8ff;",
  "hljs-built_in": "color:#ffa657;",
  "hljs-type": "color:#ffa657;",
  "hljs-literal": "color:#79c0ff;",
  "hljs-params": "color:#c9d1d9;",
  "hljs-meta": "color:#79c0ff;",
  "hljs-attr": "color:#79c0ff;",
  "hljs-attribute": "color:#a5d6ff;",
  "hljs-selector-tag": "color:#7ee787;",
  "hljs-selector-class": "color:#d2a8ff;",
  "hljs-selector-id": "color:#79c0ff;font-weight:700;",
  "hljs-selector-pseudo": "color:#7ee787;",
  "hljs-regexp": "color:#7ee787;",
  "hljs-variable constant_": "color:#79c0ff;",
  "hljs-variable language_": "color:#ff7b72;",
  "hljs-variable": "color:#c9d1d9;",
  "hljs-property": "color:#79c0ff;",
  "hljs-punctuation": "color:#c9d1d9;",
  "hljs-operator": "color:#ff7b72;",
  "hljs-tag": "color:#7ee787;",
  "hljs-name": "color:#7ee787;",
  "hljs-attr-value": "color:#a5d6ff;",
  "hljs-doctag": "color:#ff7b72;font-weight:700;",
  "hljs-section": "color:#79c0ff;font-weight:700;",
  "hljs-bullet": "color:#ffa657;",
  "hljs-code": "color:#a5d6ff;",
  "hljs-emphasis": "font-style:italic;",
  "hljs-strong": "font-weight:700;",
  "hljs-formula": "color:#c9d1d9;",
  "hljs-link": "color:#a5d6ff;text-decoration:underline;",
  "hljs-quote": "color:#a5d6ff;font-style:italic;",
  "hljs-addition": "color:#aff5b4;background-color:#033a16;",
  "hljs-deletion": "color:#ffdcd7;background-color:#67060c;",
  "hljs-subst": "color:#c9d1d9;",
  "hljs-symbol": "color:#ffa657;",
  "hljs-char": "color:#a5d6ff;",
};

/** GitHub Dark 代码块容器配色 */
const CODE_THEME = {
  bg: "#0d1117",
  headerBg: "#161b22",
  border: "#30363d",
  text: "#c9d1d9",
  headerText: "#8b949e",
};

/** 语言名称 → 显示标签 */
const LANG_LABELS: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  js: "JavaScript",
  ts: "TypeScript",
  bash: "Bash",
  shell: "Shell",
  sh: "Shell",
  sql: "SQL",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  yaml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
  rust: "Rust",
  go: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  cs: "C#",
  php: "PHP",
  ruby: "Ruby",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
  r: "R",
  lua: "Lua",
  perl: "Perl",
  dart: "Dart",
  dockerfile: "Docker",
  makefile: "Makefile",
  nginx: "Nginx",
  ini: "INI",
  toml: "TOML",
  diff: "Diff",
  plaintext: "Plain Text",
};

function encodeCodeSource(code: string): string {
  return Buffer.from(code, "utf-8").toString("base64");
}

/** 解码 buildCodeBlock 写入的 data-mp-code-source（客户端复制用） */
export function decodeCodeSource(encoded: string): string {
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(encoded, "base64").toString("utf-8");
    }
    return decodeURIComponent(escape(atob(encoded)));
  } catch {
    return "";
  }
}

const CODE_BLOCK_MARKER = /<section\s+data-mp-cb="1"/gi;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#(\d+);/g, (_full, code: string) => String.fromCharCode(Number(code)));
}

/** 解码 HTML 片段中文本节点的实体，保留标签结构不变 */
export function decodeEntitiesInHtml(html: string): string {
  return html.replace(/(<[^>]*>)|([^<]+)/g, (match, tag: string | undefined, text: string | undefined) => {
    if (tag) return tag;
    if (text) return decodeHtmlEntities(text);
    return match;
  });
}

/** 将文本节点中的普通空格替换为不换行空格，避免微信吞掉 span 之间的空白 */
export function preserveSpacesInHtml(html: string): string {
  return html.replace(/(<[^>]*>)|([^<]+)/g, (match, tag: string | undefined, text: string | undefined) => {
    if (tag) return tag;
    if (text) return text.replace(/ /g, "\u00A0");
    return match;
  });
}

/** 从高亮 HTML 还原纯文本代码（保留换行与缩进） */
export function highlightedCodeToPlainText(html: string): string {
  let text = decodeEntitiesInHtml(html);
  text = text.replace(/<span[^>]*white-space:nowrap[^>]*>/gi, "");
  text = text.replace(/<p[^>]*>/gi, "");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/span>/gi, "");
  text = text.replace(/<span[^>]*>/gi, "");
  return text.replace(/[\u00A0\u3000]/g, " ");
}

/** 从 openTagStart 起，找到与之匹配的 </section> 结束位置（不含） */
export function findSectionBlockEnd(html: string, openTagStart: number): number {
  const tagEnd = html.indexOf(">", openTagStart);
  if (tagEnd === -1) return -1;

  let depth = 1;
  let pos = tagEnd + 1;
  const openPattern = /<section\b/gi;
  const closePattern = /<\/section>/gi;

  while (depth > 0 && pos < html.length) {
    openPattern.lastIndex = pos;
    closePattern.lastIndex = pos;
    const nextOpen = openPattern.exec(html);
    const nextClose = closePattern.exec(html);
    if (!nextClose) return -1;

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) return nextClose.index + nextClose[0].length;
      pos = nextClose.index + nextClose[0].length;
    }
  }

  return -1;
}

/** 解析代码块内部的「语言栏 + 代码区」两段内容 */
export function parseCodeBlockSections(inner: string): { lang: string; code: string } {
  const sections: string[] = [];
  let pos = 0;

  while (pos < inner.length) {
    const slice = inner.slice(pos);
    const openMatch = slice.match(/<section[^>]*>/i);
    if (!openMatch || openMatch.index === undefined) break;

    const absStart = pos + openMatch.index + openMatch[0].length;
    const closeIdx = inner.indexOf("</section>", absStart);
    if (closeIdx === -1) break;

    sections.push(inner.slice(absStart, closeIdx));
    pos = closeIdx + "</section>".length;
  }

  const lang = sections[0]?.replace(/<[^>]+>/g, "").trim() || "Plain Text";
  const code = sections[1] ?? inner;
  return { lang, code };
}

function formatLangLabel(language: string): string {
  const key = language.toLowerCase().replace(/^language-/, "");
  if (LANG_LABELS[key]) return LANG_LABELS[key];
  if (hljs.getLanguage(key)) {
    return key
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return language.charAt(0).toUpperCase() + language.slice(1);
}

function inferLanguage(code: string): string | null {
  if (/\b(useEffect|useState|useCallback|useMemo|useRef|React\.)\b/.test(code)) {
    return /:\s*(string|number|boolean|void|React\.|Record<|Array<)/.test(code) ? "typescript" : "javascript";
  }
  if (/\b(import\s+.+\s+from\s+['"]|export\s+(default\s+)?function|const\s+\w+\s*=)/.test(code)) {
    return /:\s*(string|number|boolean|void|any)\b|interface\s+\w+|type\s+\w+\s*=/.test(code)
      ? "typescript"
      : "javascript";
  }
  if (/\b(async\s+)?function\s+\w+/.test(code)) return "javascript";
  if (/\b(const|let|var)\s+\w+/.test(code) && /=>/.test(code)) return "javascript";
  if (/^\s*(def|class|import|from|async def)\s/m.test(code) || /:\s*$/.test(code.split("\n")[0] ?? "")) {
    return "python";
  }
  if (/^\s*(public|private|protected)\s+(static\s+)?(class|void|int|String)/m.test(code)) {
    return "java";
  }
  if (/^\s*#include\s+[<"]/m.test(code)) return "cpp";
  if (/^\s*(package|func)\s+\w+/m.test(code)) return "go";
  if (/^\s*(fn|let mut|impl)\s/m.test(code)) return "rust";
  if (/^\s*SELECT\s+/im.test(code)) return "sql";
  if (/^\s*\{[\s\S]*"[\w-]+"\s*:/m.test(code)) return "json";
  return null;
}

function resolveLanguage(code: string, hint?: string): string {
  // 终端命令优先识别为 bash：hljs 的 auto 检测会误判（npx → CSS、git → Python），
  // 且比显式 hint 更可信（AI 常给终端命令打 language-css 之类的错误标签）。
  if (isShellCommand(code)) return "bash";

  const normalizedHint = hint?.toLowerCase().replace(/^language-/, "").trim();
  if (normalizedHint && hljs.getLanguage(normalizedHint)) {
    return normalizedHint;
  }

  const inferred = inferLanguage(code);
  if (inferred) return inferred;

  const auto = hljs.highlightAuto(code, ["javascript", "typescript", "python", "bash", "json", "html", "css", "sql"]);
  if (auto.language && auto.relevance > 3) return auto.language;

  return auto.language ?? "plaintext";
}

export function resolveLanguageLabel(code: string, hint?: string): string {
  return formatLangLabel(resolveLanguage(code, hint));
}

/** 将 span 之间的空白包进独立 span，避免微信吞掉文本节点空格 */
export function anchorSpacesBetweenTags(html: string): string {
  return html.replace(/(<\/span>)(\s+)(<span\b)/gi, (_full, close: string, spaces: string, open: string) => {
    const preserved = spaces.replace(/ /g, "\u00A0").replace(/\t/g, "\u00A0\u00A0");
    return `${close}<span>${preserved}</span>${open}`;
  });
}

function normalizeHighlightHtml(html: string): string {
  return preserveSpacesInHtml(anchorSpacesBetweenTags(decodeEntitiesInHtml(html)));
}

/** 将 span 之间的空白合并到前一个 span 内部（微信不会吞 span 内文字） */
function mergeSpacesIntoPrecedingSpan(html: string): string {
  let prev = "";
  let result = decodeEntitiesInHtml(html);
  while (prev !== result) {
    prev = result;
    result = result.replace(
      /(<span(?:\s[^>]*)?>)([\s\S]*?)(<\/span>)(\s+)(?=<span\b)/gi,
      (_full, open: string, content: string, close: string, spaces: string) =>
        `${open}${content}${spaces}${close}`,
    );
  }
  return result;
}

type StyledSegment = { text: string; style: string };

function parseStyledSegments(html: string): StyledSegment[] {
  const segments: StyledSegment[] = [];
  const re = /<span style="([^"]*)">([\s\S]*?)<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      segments.push({
        style: match[1],
        text: decodeHtmlEntities(match[2]).replace(/[\u00A0\u3000]/g, " "),
      });
    } else if (match[3]) {
      segments.push({
        style: "",
        text: decodeHtmlEntities(match[3]).replace(/[\u00A0\u3000]/g, " "),
      });
    }
  }
  return segments;
}

/**
 * 以 plainLine 为准重建高亮 HTML：保留全部空格/缩进，颜色来自 hljs 分词结果。
 * 解决微信吞掉 </span> 与 <span> 之间空白导致 functionfoo、newBar 的问题。
 */
function alignHighlightToPlain(plainLine: string, highlightedHtml: string): string {
  const merged = mergeSpacesIntoPrecedingSpan(highlightedHtml);
  const segments = parseStyledSegments(merged);

  const tokenChars: Array<{ char: string; style: string }> = [];
  for (const seg of segments) {
    for (const char of seg.text) {
      if (!/\s/.test(char)) {
        tokenChars.push({ char, style: seg.style });
      }
    }
  }

  let tokenIdx = 0;
  let result = "";
  let buffer = "";
  let bufferStyle: string | null = null;

  const flush = () => {
    if (!buffer) return;
    if (bufferStyle) {
      result += `<span style="${bufferStyle}">${buffer}</span>`;
    } else {
      result += `<span>${buffer}</span>`;
    }
    buffer = "";
    bufferStyle = null;
  };

  for (const ch of plainLine) {
    if (/\s/.test(ch)) {
      // 空格并入当前 span 内部，避免微信删除「仅含空格的 span」
      buffer += ch === "\t" ? "    " : " ";
      continue;
    }

    const token = tokenChars[tokenIdx];
    if (!token) {
      if (bufferStyle !== "") flush();
      bufferStyle = "";
      buffer += ch;
      continue;
    }

    if (token.style !== bufferStyle) {
      flush();
      bufferStyle = token.style;
    }
    buffer += ch;
    tokenIdx++;
  }
  flush();
  return result;
}

function highlightSourceLine(line: string, language: string): string {
  try {
    return hljs.highlight(line, { language, ignoreIllegals: true }).value;
  } catch {
    return hljs.highlight(line, { language: "plaintext", ignoreIllegals: true }).value;
  }
}

/** 微信专用：逐行渲染，缩进用 padding-left，空格用全角字符（不换行，长行靠容器横向滚动） */
function withWechatLineBreaks(plainCode: string, language: string): string {
  return plainCode.split("\n").map((plainLine) => {
    if (!plainLine.trim()) {
      return '<p style="margin:0;height:1em;line-height:1.65;font-size:13px;"></p>';
    }

    const indent = plainLine.match(/^(\s*)/)?.[1] ?? "";
    const indentPx = indent.replace(/\t/g, "  ").length * 4;
    const codeLine = plainLine.trimStart();

    const rawHighlight = classesToInlineStyles(highlightSourceLine(codeLine, language));
    const highlighted = alignHighlightToPlain(codeLine, rawHighlight);

    return (
      `<p style="margin:0;padding:0 0 0 ${indentPx}px;line-height:1.65;font-size:13px;` +
      `font-family:SF Mono,Menlo,Consolas,monospace;white-space:nowrap;color:${CODE_THEME.text};">${highlighted}</p>`
    );
  }).join("");
}

function buildCodeBlockForWechat(rawCode: string, langHint?: string): string {
  const decoded = decodeHtmlEntities(rawCode);
  const trimmed = decoded.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    // 空代码块：渲染占位提示，避免微信里出现「只有语言标签的黑块」
    const t = CODE_THEME;
    return codeBlockShell(
      "代码示例",
      `<p style="margin:0;padding:10px 0;text-align:center;color:${t.headerText};font-size:13px;">（此处无代码内容）</p>`,
      "",
    );
  }
  const language = resolveLanguage(decoded, langHint);
  const bodyHtml = withWechatLineBreaks(decoded, language);
  const langLabel = formatLangLabel(language);

  return codeBlockShell(langLabel, bodyHtml, "");
}

function rebuildExistingCodeBlocks(html: string): string {
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  CODE_BLOCK_MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_MARKER.exec(html)) !== null) {
    const start = match.index;
    const end = findSectionBlockEnd(html, start);
    if (end === -1) continue;

    const tagEnd = html.indexOf(">", start) + 1;
    const inner = html.slice(tagEnd, end - "</section>".length);
    const { code } = parseCodeBlockSections(inner);
    const plain = highlightedCodeToPlainText(code);
    if (!plain.trim()) continue;

    replacements.push({ start, end, replacement: buildCodeBlock(plain) });
  }

  let result = html;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, replacement } = replacements[i];
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

function protectDataMpCodeBlocks(html: string): { html: string; blocks: string[] } {
  const blocks: string[] = [];
  const replacements: Array<{ start: number; end: number; token: string }> = [];

  CODE_BLOCK_MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_MARKER.exec(html)) !== null) {
    const start = match.index;
    const end = findSectionBlockEnd(html, start);
    if (end === -1) continue;
    const idx = blocks.length;
    blocks.push(html.slice(start, end));
    replacements.push({ start, end, token: `<!--MP-HCB-${idx}-->` });
  }

  let result = html;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, token } = replacements[i];
    result = result.slice(0, start) + token + result.slice(end);
  }

  return { html: result, blocks };
}

/**
 * 判断代码是否为「终端命令 / Shell 脚本」。
 * 放在语言识别最前面：highlight.js 的 auto 检测会把
 * `npx ts-migrate --transforms ...` 这类命令误判成 CSS（-- 与 transforms 命中 CSS 特征），
 * 把 git 命令误判成 Python，导致微信文章代码块语言标签与内容不符。
 */
function isShellCommand(code: string): boolean {
  if (!code || !code.trim()) return false;

  const firstLine = code.trimStart().split(/\r?\n/)[0] ?? "";
  // 以常见命令名开头（排除 YAML 的 `cd: xxx`、`key: value` 等误报）
  const cmdStartRe =
    /^\s*(?:sudo\s+)?(?:npx|npm|yarn|pnpm|bun|bunx|nvm|node|deno|git|docker|docker-compose|kubectl|helm|terraform|curl|wget|ssh|scp|rsync|cd|ls|cat|grep|sed|awk|find|xargs|chmod|chown|mkdir|rmdir|rm|cp|mv|touch|tar|unzip|zip|gzip|make|cmake|cargo|go\s+run|go\s+build|rustc|python|python3|pip|pip3|poetry|uv|psql|mysql|sqlite3|redis-cli|mongosh|java|mvn|gradle|echo|printf|export|env|which|whereis|history|clear|alias|source|watch|time|perl|php|ruby|gem|brew|apt|apt-get|yum|dnf|pacman|systemctl|service|ps|top|htop|df|du|free|ip|ifconfig|netstat|ss|ping|traceroute|dig|nslookup|openssl|jq|tree|head|tail|sort|uniq|wc|cut|tr|paste|join|comm|diff|patch|zcat|less|more|vim|vi|nano)\b(?!\s*[:=])/i;
  if (cmdStartRe.test(firstLine)) return true;

  // 含典型 shell 操作符（管道 / 重定向 / 命令串联 / 变量展开），视为脚本片段
  return /(?:\|\s*[a-z]+|&&|\|\||\b2>&1\b|\$\{|\b>\s*\S+\s*$|`[^`]+`)/i.test(firstLine);
}

/**
 * 将 hljs 输出的 class-based HTML 转换为内联样式 HTML
 */
function classesToInlineStyles(hljsHtml: string): string {
  return hljsHtml.replace(
    /<span class="([^"]*)">/g,
    (_full, classNames: string) => {
      const styles: string[] = [];
      for (const cls of classNames.split(/\s+/)) {
        if (TOKEN_STYLES[cls]) {
          styles.push(TOKEN_STYLES[cls]);
        }
      }
      if (styles.length > 0) {
        return `<span style="${styles.join(" ")}">`;
      }
      return `<span>`;
    },
  );
}

function withLineBreaks(inlineHtml: string): string {
  return inlineHtml
    .split("\n")
    .map((line) => {
      if (!line) return "<br>";
      return `<span style="white-space:nowrap;display:inline-block;">${line}</span><br>`;
    })
    .join("");
}

function codeBlockShell(
  langLabel: string,
  bodyHtml: string,
  codeSourceAttr: string,
): string {
  const t = CODE_THEME;
  // 微信场景与预览共用同一结构：正文横向滚动（white-space:nowrap + overflow:auto），
  // 长行可左右滑动查看完整代码；max-height 限制纵向高度避免撑爆文章。
  return [
    `<section data-mp-cb="1"${codeSourceAttr} style="border-radius:8px;border:1px solid ${t.border};background-color:${t.bg};overflow:hidden;margin:16px 0;font-family:SF Mono,Menlo,Consolas,monospace;">`,
    `<section data-mp-cb-lang="1" style="padding:8px 14px;background-color:${t.headerBg};color:${t.headerText};font-size:12px;letter-spacing:0.05em;border-bottom:1px solid ${t.border};text-align:left;font-weight:600;">${langLabel}</section>`,
    `<section data-mp-cb-body="1" style="padding:12px 14px;font-size:13px;line-height:1.6;color:${t.text};max-height:420px;overflow:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;">${bodyHtml}</section>`,
    "</section>",
  ].join("");
}

function looksLikeMultiLineCode(text: string): boolean {
  if (!text) return false;
  if (/\n/.test(text)) return true;
  if (/;\s*\w+\s*=/.test(text)) return true;
  if (/:\s*$/.test(text)) return true;
  if (/^\s*(def|class|import|from|function|const|let|var|if|for|while|return|package|public|private|static)\s+\w+/.test(text)) {
    return true;
  }
  if (/[(){}\[\]]/.test(text) && /[<>]=?/.test(text)) return true;
  return false;
}

function buildCodeBlock(rawCode: string, langHint?: string): string {
  const decoded = decodeHtmlEntities(rawCode);
  const language = resolveLanguage(decoded, langHint);
  let highlighted: string;
  try {
    highlighted = hljs.highlight(decoded, { language }).value;
  } catch {
    highlighted = hljs.highlight(decoded, { language: "plaintext" }).value;
  }
  const inlineHtml = normalizeHighlightHtml(classesToInlineStyles(highlighted));
  const linedHtml = withLineBreaks(inlineHtml);
  const langLabel = formatLangLabel(language);

  return codeBlockShell(langLabel, linedHtml, ` data-mp-code-source="${encodeCodeSource(decoded)}"`);
}

/** 从纯文本代码渲染完整代码块（预览用） */
export function renderCodeBlock(rawCode: string, langHint?: string): string {
  return buildCodeBlock(rawCode, langHint);
}

/** 从纯文本代码渲染微信专用代码块（逐行缩进 + 全角空格） */
export function renderCodeBlockForWechat(rawCode: string, langHint?: string): string {
  return buildCodeBlockForWechat(rawCode, langHint);
}

/**
 * 对 HTML 内容中所有代码块进行语法高亮
 */
export function highlightCodeBlocks(html: string): string {
  html = rebuildExistingCodeBlocks(html);

  html = html.replace(
    /<pre><code(?:\s+class="[^"]*language-([\w-]+)[^"]*")?(?:\s+[^>]*)?>([\s\S]*?)<\/code><\/pre>/gi,
    (_full, langHint: string | undefined, code: string) => buildCodeBlock(code, langHint),
  );

  const protectedBlocks = protectDataMpCodeBlocks(html);
  html = protectedBlocks.html;

  html = html.replace(
    /<code([^>]*)>([\s\S]*?)<\/code>/gi,
    (_full, attrs: string, code: string) => {
      if (attrs.includes("data-mp-code")) return _full;
      const classMatch = attrs.match(/class="[^"]*language-([\w-]+)/i);
      const codeStr = decodeHtmlEntities(code);
      if (!looksLikeMultiLineCode(codeStr)) return _full;
      return buildCodeBlock(code, classMatch?.[1]);
    },
  );

  html = html.replace(/<!--MP-HCB-(\d+)-->/g, (_full, index: string) => {
    return protectedBlocks.blocks[parseInt(index, 10)] ?? "";
  });

  html = html.replace(
    /(<section data-mp-cb-body="1" style="[^"]*?)(">)/gi,
    (_full, prefix: string, close: string) => {
      let updated = prefix
        .replace(/white-space:pre-wrap;?/gi, "")
        .replace(/word-break:break-word;?/gi, "")
        .replace(/overflow-wrap:break-word;?/gi, "")
        .replace(/color:#24292f;?/gi, "");
      if (!updated.includes("color:")) {
        updated += `color:${CODE_THEME.text};`;
      }
      if (!updated.includes("max-height:")) {
        updated += "max-height:420px;overflow:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;";
      }
      return updated + close;
    },
  );

  return html;
}
