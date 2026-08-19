/**
 * Convert Draftly WeChat-oriented HTML to VitePress Markdown.
 * Handles mp-tip / mp-warning / data-mp-cb code blocks from Draftly preview HTML.
 */
import { decodeCodeSource } from "@/lib/code-highlight";

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

/** Like stripTags but keep inline emphasis/code tags for VitePress HTML output. */
function stripTagsKeepInline(html: string): string {
  return decodeEntities(
    html.replace(/<(?!\/?(?:strong|em|code)\b)[^>]+>/gi, ""),
  ).trim();
}

function isBoldSpanStyle(attrs: string): boolean {
  return /font-weight\s*:\s*(?:bold|700|800|900|bolder)\b/i.test(attrs);
}

function isItalicSpanStyle(attrs: string): boolean {
  return /font-style\s*:\s*italic\b/i.test(attrs);
}

function wrapInlineTag(tag: "strong" | "em", text: string): string {
  const t = text.trim();
  return t ? `<${tag}>${t}</${tag}>` : "";
}

function mapLangLabel(label: string): string {
  const t = label.trim().toLowerCase();
  if (!t || t === "plain text" || t === "plaintext") return "";
  if (t === "javascript" || t === "js") return "javascript";
  if (t === "typescript" || t === "ts") return "typescript";
  if (t === "html") return "html";
  if (t === "css") return "css";
  if (t === "json") return "json";
  if (t === "bash" || t === "shell" || t === "sh") return "bash";
  if (t === "python" || t === "py") return "python";
  if (t === "sql") return "sql";
  if (t === "yaml" || t === "yml") return "yaml";
  if (t === "markdown" || t === "md") return "markdown";
  return t.replace(/[^a-z0-9_+-]/g, "") || "";
}

/** Replace Draftly/WeChat highlighted code sections with fenced Markdown. */
export function extractMpCodeBlocks(html: string): string {
  const openRe = /<section\b[^>]*\bdata-mp-cb="1"[^>]*>/gi;
  let result = "";
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = openRe.exec(html)) !== null) {
    result += html.slice(last, m.index);
    const openTag = m[0];
    const contentStart = m.index + openTag.length;

    let depth = 1;
    let i = contentStart;
    let end = -1;
    while (i < html.length && depth > 0) {
      const nextOpen = html.toLowerCase().indexOf("<section", i);
      const nextClose = html.toLowerCase().indexOf("</section>", i);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen + 8;
      } else {
        depth -= 1;
        if (depth === 0) {
          end = nextClose;
          break;
        }
        i = nextClose + 10;
      }
    }

    if (end < 0) {
      result += openTag;
      last = contentStart;
      continue;
    }

    const inner = html.slice(contentStart, end);
    const fullEnd = end + "</section>".length;

    const srcAttr = openTag.match(/data-mp-code-source="([^"]*)"/i)?.[1] ?? "";
    let code = srcAttr ? decodeCodeSource(srcAttr) : "";
    if (!code) {
      // 兼容新旧代码块结构：body 可能是单个 <section>，也可能是平级 <p> 行
      const sectionBody = inner.match(/data-mp-cb-body="1"[^>]*>([\s\S]*?)<\/section>/i)?.[1];
      const pBody = [...inner.matchAll(/<p\s+data-mp-cb-body="1"[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((mm) => mm[1])
        .join("\n");
      const body = sectionBody ?? (pBody ? pBody : inner);
      code = decodeEntities(
        body
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/span>/gi, "")
          .replace(/<span[^>]*>/gi, "")
          .replace(/<[^>]+>/g, ""),
      );
    }

    const langLabel =
      inner.match(/data-mp-cb-lang="1"[^>]*>([\s\S]*?)<\/(?:section|p)>/i)?.[1] ?? "";
    const lang = mapLangLabel(stripTags(langLabel));
    const fenced = `\n\n\`\`\`${lang}\n${code.replace(/\n$/, "")}\n\`\`\`\n\n`;
    result += fenced;
    last = fullEnd;
    openRe.lastIndex = fullEnd;
  }

  result += html.slice(last);
  return result;
}

function inlineToMd(
  html: string,
  rewriteSrc?: (src: string) => string | null | undefined,
): string {
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<img(\s[^>]*)?\/?>/gi, (full) => {
    const src = full.match(/src=["']([^"']+)["']/i)?.[1] ?? "";
    const alt = full.match(/alt=["']([^"']*)["']/i)?.[1] ?? "image";
    const next = src && rewriteSrc ? rewriteSrc(src) ?? src : src;
    return next ? `![${alt}](${next})` : "";
  });
  // WeChat 样式常把 strong 落成 span[style*=font-weight]
  s = s.replace(/<span(\s[^>]*)>([\s\S]*?)<\/span>/gi, (full, attrs: string, inner) => {
    if (isBoldSpanStyle(attrs)) return wrapInlineTag("strong", stripTags(inner));
    if (isItalicSpanStyle(attrs)) return wrapInlineTag("em", stripTags(inner));
    return stripTags(inner);
  });
  s = s.replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) =>
    wrapInlineTag("strong", stripTags(inner)),
  );
  s = s.replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) =>
    wrapInlineTag("em", stripTags(inner)),
  );
  // 生成稿若误带 Markdown 加粗，转成 HTML 以便 VitePress 混排 HTML 时也能渲染
  s = s.replace(/\*\*([^*\n]+)\*\*/g, (_m, inner: string) => wrapInlineTag("strong", inner));
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_m, inner: string) => wrapInlineTag("em", inner));
  s = s.replace(/<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/gi, (_m, inner) => {
    const t = stripTags(inner).replace(/`/g, "\\`");
    return t ? `\`${t}\`` : "";
  });
  s = s.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const t = stripTags(inner) || href;
    return `[${t}](${href})`;
  });
  const images: string[] = [];
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, (img) => {
    images.push(img);
    return `\0IMG${images.length - 1}\0`;
  });
  s = stripTagsKeepInline(s);
  s = s.replace(/\0IMG(\d+)\0/g, (_m, idx) => images[Number(idx)] ?? "");
  return s;
}

function convertList(
  html: string,
  ordered: boolean,
  rewriteSrc?: (src: string) => string | null | undefined,
): string {
  const items = [...html.matchAll(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi)];
  if (items.length === 0) return "";
  return items
    .map((m, i) => {
      const body = inlineToMd(m[1].replace(/<\/?p(?:\s[^>]*)?>/gi, " ").trim(), rewriteSrc);
      const marker = ordered ? `${i + 1}.` : "-";
      return `${marker} ${body}`;
    })
    .join("\n");
}

function cellText(
  html: string,
  rewriteSrc?: (src: string) => string | null | undefined,
): string {
  return inlineToMd(html.replace(/<\/?p(?:\s[^>]*)?>/gi, " ").trim(), rewriteSrc)
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();
}

/** Convert HTML table to GFM markdown table (VitePress / penn-notes). */
export function convertTable(
  tableHtml: string,
  rewriteSrc?: (src: string) => string | null | undefined,
): string {
  const rows: string[][] = [];
  const rowRe = /<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<(th|td)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cellText(cellMatch[2], rewriteSrc) || " ");
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push(" ");
    return padded;
  });

  const header = normalized[0];
  const body = normalized.slice(1);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function convertPre(html: string): string {
  const codeMatch = html.match(/<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/i);
  const raw = codeMatch ? codeMatch[1] : html.replace(/<\/?pre(?:\s[^>]*)?>/gi, "");
  const langMatch = html.match(/class=["'][^"']*language-([a-z0-9_+-]+)/i);
  const lang = langMatch?.[1] ?? "";
  const text = decodeEntities(raw.replace(/<[^>]+>/g, "")).replace(/\n$/, "");
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function convertAll(
  html: string,
  rewriteSrc?: (src: string) => string | null | undefined,
): string {
  const fences: string[] = [];
  let s = html.replace(/```[\s\S]*?```/g, (block) => {
    fences.push(block);
    return `\n\n%%FENCE${fences.length - 1}%%\n\n`;
  });

  const callouts: string[] = [];
  const takeCallouts = (cls: string, fence: string) => {
    s = s.replace(
      new RegExp(`<div class="${cls}">([\\s\\S]*?)<\\/div>`, "gi"),
      (_m, inner) => {
        callouts.push(`${fence}\n${inlineToMd(inner, rewriteSrc)}\n:::`);
        return `\n\n%%CALLOUT${callouts.length - 1}%%\n\n`;
      },
    );
  };
  takeCallouts("mp-tip", "::: tip");
  takeCallouts("mp-warning", "::: warning");
  takeCallouts("mp-summary", "::: info 总结");

  const tables: string[] = [];
  s = s.replace(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/gi, (full) => {
    tables.push(convertTable(full, rewriteSrc));
    return `\n\n%%TABLE${tables.length - 1}%%\n\n`;
  });

  s = s.replace(/<\/?section(?:\s[^>]*)?>/gi, "\n");

  const out: string[] = [];
  const blockRe =
    /<(h[1-6]|p|pre|ul|ol|blockquote|figure)(\s[^>]*)?>([\s\S]*?)<\/\1>|<hr\s*\/?>|<img(\s[^>]*)?\/?>|%%(?:FENCE|CALLOUT|TABLE)\d+%%/gi;

  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(s)) !== null) {
    const between = s.slice(last, m.index);
    const betweenText = inlineToMd(between, rewriteSrc);
    if (betweenText) out.push(betweenText);

    const full = m[0];
    const fenceMatch = full.match(/^%%FENCE(\d+)%%$/);
    const calloutMatch = full.match(/^%%CALLOUT(\d+)%%$/);
    const tableMatch = full.match(/^%%TABLE(\d+)%%$/);
    if (fenceMatch) {
      out.push(fences[Number(fenceMatch[1])] ?? "");
    } else if (calloutMatch) {
      out.push(callouts[Number(calloutMatch[1])] ?? "");
    } else if (tableMatch) {
      const t = tables[Number(tableMatch[1])] ?? "";
      if (t) out.push(t);
    } else if (/^<hr/i.test(full)) {
      out.push("---");
    } else if (/^<img/i.test(full)) {
      const src = full.match(/src=["']([^"']+)["']/i)?.[1] ?? "";
      const alt = full.match(/alt=["']([^"']*)["']/i)?.[1] ?? "image";
      const next = src && rewriteSrc ? rewriteSrc(src) ?? src : src;
      if (next) out.push(`![${alt}](${next})`);
    } else {
      const tag = (m[1] ?? "").toLowerCase();
      const inner = m[3] ?? "";
      if (tag.startsWith("h")) {
        const level = Number(tag[1]) || 2;
        const mdLevel = Math.max(level, 2);
        out.push(`${"#".repeat(mdLevel)} ${inlineToMd(inner, rewriteSrc)}`);
      } else if (tag === "p") {
        const t = inlineToMd(inner, rewriteSrc);
        if (t) out.push(t);
      } else if (tag === "pre") {
        out.push(convertPre(full));
      } else if (tag === "ul") {
        out.push(convertList(inner, false, rewriteSrc));
      } else if (tag === "ol") {
        out.push(convertList(inner, true, rewriteSrc));
      } else if (tag === "blockquote") {
        out.push(`> ${inlineToMd(inner, rewriteSrc)}`);
      } else if (tag === "figure") {
        const img = inner.match(/<img[^>]+>/i)?.[0];
        if (img) {
          const src = img.match(/src=["']([^"']+)["']/i)?.[1] ?? "";
          const alt = img.match(/alt=["']([^"']*)["']/i)?.[1] ?? "image";
          const next = src && rewriteSrc ? rewriteSrc(src) ?? src : src;
          if (next) {
            const captionMatch = inner.match(
              /<figcaption(?:\s[^>]*)?>([\s\S]*?)<\/figcaption>/i,
            );
            const caption = captionMatch ? stripTags(captionMatch[1]).trim() : "";
            if (caption) {
              out.push(
                `<figure class="inline-figure"><img src="${next}" alt="${escapeAttr(alt)}" /><figcaption>${escapeHtml(caption)}</figcaption></figure>`,
              );
            } else {
              out.push(`![${alt}](${next})`);
            }
          }
        }
      }
    }
    last = m.index + full.length;
  }
  const tail = inlineToMd(s.slice(last), rewriteSrc);
  if (tail) out.push(tail);

  let md = out.filter(Boolean).join("\n\n");
  md = md
    .replace(/%%FENCE(\d+)%%/g, (_x, idx) => fences[Number(idx)] ?? "")
    .replace(/%%CALLOUT(\d+)%%/g, (_x, idx) => callouts[Number(idx)] ?? "")
    .replace(/%%TABLE(\d+)%%/g, (_x, idx) => tables[Number(idx)] ?? "");
  return `${md.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Extract unique http(s) image URLs from HTML for download/upload. */
export function collectImageSrcs(html: string): string[] {
  const srcs: string[] = [];
  const seen = new Set<string>();
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1]?.trim();
    if (!src || src.startsWith("data:")) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    srcs.push(src);
  }
  return srcs;
}

export function guessImageExt(url: string, contentType?: string | null): string {
  const fromType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (fromType === "image/png") return "png";
  if (fromType === "image/webp") return "webp";
  if (fromType === "image/gif") return "gif";
  if (fromType === "image/jpeg" || fromType === "image/jpg") return "jpg";

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.(png|jpe?g|webp|gif)$/);
    if (match) return match[1] === "jpeg" ? "jpg" : match[1];
  } catch {
    /* ignore */
  }
  return "jpg";
}

/**
 * Convert WeChat HTML to Markdown.
 * Optionally rewrite image URLs via `rewriteSrc(original) => public path`.
 */
export function htmlToBlogMarkdown(
  html: string,
  options?: { rewriteSrc?: (src: string) => string | null | undefined },
): string {
  const withCode = extractMpCodeBlocks(html);
  return convertAll(withCode, options?.rewriteSrc);
}
