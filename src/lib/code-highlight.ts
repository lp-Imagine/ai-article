/**
 * 代码语法高亮工具
 *
 * 基于 highlight.js，将 <pre><code> 代码块转换为「微信公众号兼容」的高亮 HTML。
 * 输出结构为嵌套 <section>，完全靠内联样式，不依赖任何 class / pseudo / position。
 *
 * 结构：
 *   <section style="border-radius:10px;border:1px solid #313244;background-color:#1e1e2e;overflow:hidden;margin:20px 0;">
 *     <section style="padding:6px 14px;background-color:#181825;color:#a6adc8;font-size:12px;letter-spacing:0.1em;font-family:SF Mono,Menlo,monospace;border-bottom:1px solid #313244;">PYTHON</section>
 *     <section style="padding:14px 16px;font-size:13px;line-height:1.7;color:#cdd6f4;font-family:SF Mono,Menlo,monospace;overflow:auto;max-height:360px;white-space:nowrap;">
 *       <span style="...">高亮后的代码...</span>
 *     </section>
 *   </section>
 */

import hljs from "highlight.js";

/** GitHub Light 配色 → 内联样式映射（适配亮色背景 #f6f8fa） */
const TOKEN_STYLES: Record<string, string> = {
  "hljs-keyword": "color:#cf222e;font-weight:600;",
  "hljs-string": "color:#0a3069;",
  "hljs-number": "color:#0550ae;",
  "hljs-comment": "color:#6e7781;font-style:italic;",
  "hljs-title function_": "color:#8250df;",
  "hljs-title class_": "color:#953800;font-weight:700;",
  "hljs-title": "color:#8250df;",
  "hljs-built_in": "color:#cf222e;",
  "hljs-type": "color:#953800;",
  "hljs-literal": "color:#0550ae;",
  "hljs-params": "color:#1f2328;",
  "hljs-meta": "color:#0550ae;",
  "hljs-attr": "color:#0550ae;",
  "hljs-attribute": "color:#0a3069;",
  "hljs-selector-tag": "color:#116329;",
  "hljs-selector-class": "color:#6f42bc;",
  "hljs-selector-id": "color:#116329;font-weight:700;",
  "hljs-selector-pseudo": "color:#116329;",
  "hljs-regexp": "color:#116329;",
  "hljs-variable constant_": "color:#0550ae;",
  "hljs-variable language_": "color:#cf222e;",
  "hljs-variable": "color:#1f2328;",
  "hljs-property": "color:#0550ae;",
  "hljs-punctuation": "color:#1f2328;",
  "hljs-operator": "color:#cf222e;",
  "hljs-tag": "color:#116329;",
  "hljs-name": "color:#116329;",
  "hljs-attr-value": "color:#0a3069;",
  "hljs-doctag": "color:#cf222e;font-weight:700;",
  "hljs-section": "color:#0550ae;font-weight:700;",
  "hljs-bullet": "color:#953800;",
  "hljs-code": "color:#0a3069;",
  "hljs-emphasis": "font-style:italic;",
  "hljs-strong": "font-weight:700;",
  "hljs-formula": "color:#1f2328;",
  "hljs-link": "color:#0969da;text-decoration:underline;",
  "hljs-quote": "color:#0a3069;font-style:italic;",
  "hljs-addition": "color:#116329;background-color:#dafbe1;",
  "hljs-deletion": "color:#82071e;background-color:#ffebe9;",
  "hljs-subst": "color:#1f2328;",
  "hljs-symbol": "color:#953800;",
  "hljs-char": "color:#0a3069;",
};

/** 语言名称 → 中文显示标签 */
const LANG_LABELS: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
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
  plaintext: "Code",
};

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

/**
 * 把已高亮的 HTML 中的换行 \n 转成 <br>
 * 每行代码用 nowrap span 包裹，让整行不折行，超出宽度后让外层 overflow:auto 横向滚动
 */
function withLineBreaks(inlineHtml: string): string {
  return inlineHtml
    .split("\n")
    .map((line) => {
      if (!line) return "<br>";
      return `<span style="white-space:nowrap;display:inline-block;">${line}</span><br>`;
    })
    .join("");
}

/**
 * 检测一段字符串是否像"多行代码"——具备明确的代码关键字、含换行、或含常见符号
 */
function looksLikeMultiLineCode(text: string): boolean {
  if (!text) return false;
  const hasNewline = /\n/.test(text);
  if (hasNewline) return true;
  // 单行但符合多行代码特征
  if (/;\s*\w+\s*=/.test(text)) return true; // 多语句
  if (/:\s*$/.test(text)) return true; // Python 类/函数定义行
  if (/^\s*(def|class|import|from|function|const|let|var|if|for|while|return|package|public|private|static)\s+\w+/.test(text)) return true;
  if (/[(){}\[\]]/.test(text) && /[<>]=?/.test(text)) return true; // 含比较/运算符
  return false;
}

/**
 * 把一段原始代码 + 语言名 → GitHub 风格 section HTML（嵌套 section 结构）
 */
function buildCodeBlock(rawCode: string): string {
  const decoded = rawCode
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const result = hljs.highlightAuto(decoded);
  const inlineHtml = classesToInlineStyles(result.value);
  const linedHtml = withLineBreaks(inlineHtml);
  const langLabel = LANG_LABELS[result.language ?? ""] ?? "Code";

  return [
    '<section data-mp-cb="1" style="border-radius:6px;border:1px solid #d0d7de;background-color:#f6f8fa;overflow:hidden;margin:16px 0;font-family:SF Mono,Menlo,Consolas,monospace;">',
    `<section style="padding:6px 14px;background-color:#eaeef2;color:#57606a;font-size:12px;letter-spacing:0.05em;border-bottom:1px solid #d0d7de;text-align:left;font-weight:600;">${langLabel}</section>`,
    // 代码区：white-space:nowrap 让单行不折行，横向滚动生效；max-height 限制高度，纵向滚动生效
    // -webkit-overflow-scrolling:touch 让移动端滚动更顺滑
    `<section style="padding:12px 14px;font-size:13px;line-height:1.6;color:#24292f;max-height:420px;overflow:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;">${linedHtml}</section>`,
    '</section>',
  ].join("");
}

/**
 * 对 HTML 内容中所有代码块进行语法高亮
 * 处理两类：
 *   1. <pre><code>...</code></pre> 包裹的代码块
 *   2. 段落里具备多行代码特征的行内 <code>...</code>（自动升级为 GitHub 风格代码块）
 */
export function highlightCodeBlocks(html: string): string {
  // 第一步：处理 <pre><code>...</code></pre>
  html = html.replace(
    /<pre><code(?:\s+[^>]*)?>([\s\S]*?)<\/code><\/pre>/gi,
    (_full, code: string) => buildCodeBlock(code),
  );

  // 第二步：先把已生成的代码块（GitHub 风格）标记到一个 placeholder，避免被下一步误处理
  // 使用 HTML 注释作为占位（浏览器不解析，可在末尾还原）
  const tokenStart = `<!--MP-HCB-START${Date.now().toString(36)}-->`;
  const tokenEnd = `<!--MP-HCB-END${Date.now().toString(36)}-->`;
  const placeholders: string[] = [];
  html = html.replace(
    /<section data-mp-cb="1"[^>]*>[\s\S]*?<\/section>/gi,
    (match) => {
      const idx = placeholders.length;
      placeholders.push(match);
      return `${tokenStart}${idx}${tokenEnd}`;
    },
  );

  html = html.replace(
    /<code([^>]*)>([\s\S]*?)<\/code>/gi,
    (_full, attrs: string, code: string) => {
      // 跳过已经有 data-mp-code 标记（已用 placeholder 保护的）
      if (attrs.includes("data-mp-code")) return _full;
      const codeStr = code.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      if (!looksLikeMultiLineCode(codeStr)) return _full;
      return buildCodeBlock(code);
    },
  );

  // 还原占位
  html = html.replace(
    new RegExp(`${tokenStart}(\\d+)${tokenEnd}`, "g"),
    (_full, index: string) => placeholders[parseInt(index, 10)] ?? "",
  );

  // 第三步：升级已有代码块的样式（旧版没有 max-height/overflow/white-space:nowrap）
  // 匹配代码区 section（background-color:#f6f8fa 的子 section 中含代码样式）
  html = html.replace(
    /(<section style="[^"]*?(color:#24292f;)[^"]*?)(">)/gi,
    (_full, prefix: string, _color: string, close: string) => {
      // 去掉旧的不兼容微信的样式
      let updated = prefix
        .replace(/white-space:pre-wrap;?/gi, "")
        .replace(/word-break:break-word;?/gi, "")
        .replace(/overflow-wrap:break-word;?/gi, "");
      // 追加新样式
      updated += "max-height:420px;overflow:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;";
      return updated + close;
    },
  );

  return html;
}
