/**
 * 微信公众号样式转换工具
 *
 * 将 mp-preview 的 CSS 类样式转换为微信兼容的内联样式。
 * 微信只支持有限的内联 style 属性，不支持：
 *   - CSS 类名、<style> 标签
 *   - ::before / ::after 伪元素
 *   - CSS 渐变色（linear-gradient / radial-gradient）
 *   - box-shadow
 *   - position: absolute / fixed
 *   - CSS 自定义属性（var(--xxx)）
 *   - counter-reset / counter-increment
 */

import {
  findSectionBlockEnd,
  highlightedCodeToPlainText,
  parseCodeBlockSections,
  renderCodeBlockForWechat,
} from "@/lib/code-highlight";

const ACCENT = "#3e7bfa";
const WARNING = "#e7a93b";
const WARNING_BG = "#fff8eb";

const TIP = {
  border: "#93c5fd",
  bg: "#f8fbff",
  headerBg: "#eff6ff",
  headerBorder: "#dbeafe",
  label: "#2563eb",
  text: "#1e3a5f",
};

const WARN = {
  border: "#fcd34d",
  bg: "#fffdf7",
  headerBg: "#fffbeb",
  headerBorder: "#fde68a",
  label: "#d97706",
  text: "#78350f",
};

const SUMMARY = {
  bg: "#f0f4ff",
  border: "#2563eb",
  text: "#3d3d3d",
};

const DROP_CAP_STYLE =
  "float:left;font-size:52px;font-weight:900;color:#0071e3;line-height:0.82;margin:2px 10px 0 0;font-family:Georgia,serif;";

const LIST_CARD = {
  bg: "#f8fbff",
  border: "#dbeafe",
  title: "#1a1a1a",
  body: "#555555",
};

const STRONG_STYLE =
  "color:#111111;font-weight:bold;background-color:#fff8e6;padding:0 3px;";

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function normalizeListItemInner(inner: string): string {
  return inner
    .trim()
    .replace(/^<p(?:\s[^>]*)?>/i, "")
    .replace(/<\/p>$/i, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+[：:]\s+/g, " ")
    .replace(/^[：:]\s*/, "");
}

function parseListItemTitleBody(inner: string): { title: string; body: string } | null {
  const normalized = normalizeListItemInner(inner);
  const match = normalized.match(/^<strong(?:\s[^>]*)?>([\s\S]*?)<\/strong>\s*([\s\S]+)$/i);
  if (!match) return null;

  const title = stripTags(match[1]);
  let body = match[2].trim().replace(/^[：:]\s*/, "");
  body = body.replace(/^<p(?:\s[^>]*)?>/i, "").replace(/<\/p>$/i, "").trim();
  if (!title || !body || stripTags(body).length < 4) return null;

  return { title, body };
}

function buildOrderedListCard(counter: number, title: string, body: string): string {
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 12px;border:1px solid ${LIST_CARD.border};background-color:${LIST_CARD.bg};border-radius:10px;">` +
    `<tr>` +
    `<td style="width:44px;padding:14px 0 14px 12px;vertical-align:top;border:none;">` +
    `<span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:${ACCENT};color:#ffffff;border-radius:50%;font-size:13px;font-weight:bold;">${counter}</span>` +
    `</td>` +
    `<td style="padding:14px 14px 14px 0;vertical-align:top;border:none;">` +
    `<section style="font-size:15px;font-weight:bold;color:${LIST_CARD.title};margin:0 0 6px;line-height:1.5;">${title}</section>` +
    `<section style="font-size:14px;color:${LIST_CARD.body};line-height:1.75;margin:0;text-align:justify;">${body}</section>` +
    `</td></tr></table>`
  );
}

function buildUnorderedListCard(title: string, body: string): string {
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 12px;border:1px solid ${LIST_CARD.border};border-left:4px solid ${ACCENT};background-color:${LIST_CARD.bg};border-radius:0 10px 10px 0;">` +
    `<tr><td style="padding:14px 16px;border:none;">` +
    `<section style="font-size:15px;font-weight:bold;color:${LIST_CARD.title};margin:0 0 6px;line-height:1.5;">${title}</section>` +
    `<section style="font-size:14px;color:${LIST_CARD.body};line-height:1.75;margin:0;text-align:justify;">${body}</section>` +
    `</td></tr></table>`
  );
}

function buildPlainListItem(counter: number | null, inner: string, ordered: boolean): string {
  const clean = normalizeListItemInner(inner);
  if (ordered && counter !== null) {
    return (
      `<table style="width:100%;border-collapse:collapse;margin:0 0 10px;">` +
      `<tr><td style="width:44px;padding:8px 0 8px 12px;vertical-align:top;border:none;">` +
      `<span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:${ACCENT};color:#ffffff;border-radius:50%;font-size:13px;font-weight:bold;">${counter}</span>` +
      `</td><td style="padding:8px 14px 8px 0;vertical-align:top;font-size:15px;color:#3a3a3a;line-height:1.8;border:none;">${clean}</td></tr></table>`
    );
  }
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 10px;">` +
    `<tr><td style="width:20px;padding:10px 0 10px 8px;vertical-align:top;border:none;">` +
    `<span style="display:inline-block;width:8px;height:8px;background-color:${ACCENT};border-radius:2px;opacity:0.75;"></span>` +
    `</td><td style="padding:10px 14px 10px 0;vertical-align:top;font-size:15px;color:#3a3a3a;line-height:1.8;border:none;">${clean}</td></tr></table>`
  );
}

function transformListBlock(html: string, ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return html.replace(re, (_full, inner: string) => {
    const items: string[] = [];
    let counter = 0;
    const liRe = /<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi;
    let liMatch: RegExpExecArray | null;
    while ((liMatch = liRe.exec(inner)) !== null) {
      const liInner = liMatch[1];
      const parsed = parseListItemTitleBody(liInner);
      if (parsed) {
        if (ordered) {
          counter++;
          items.push(buildOrderedListCard(counter, parsed.title, parsed.body));
        } else {
          items.push(buildUnorderedListCard(parsed.title, parsed.body));
        }
      } else {
        counter++;
        items.push(buildPlainListItem(ordered ? counter : null, liInner, ordered));
      }
    }
    return `<section style="margin:14px 0 20px;">${items.join("")}</section>`;
  });
}

function applyStrongStyles(html: string): string {
  let result = html.replace(/<b(\s[^>]*)?>/gi, "<strong>");
  result = result.replace(/<\/b>/gi, "</strong>");
  result = result.replace(/<strong(\s[^>]*)?>/gi, (_full, attrs?: string) => {
    if (attrs && /style\s*=/i.test(attrs)) {
      return _full.replace(
        /style\s*=\s*"([^"]*)"/i,
        (_s, existing: string) =>
          `style="${existing}color:#111111;font-weight:bold;background-color:#fff8e6;padding:0 3px;"`,
      );
    }
    return `<strong style="${STRONG_STYLE}">`;
  });
  return result;
}

function buildCalloutTable(
  icon: string,
  inner: string,
  options: {
    border: string;
    bg: string;
    headerBg: string;
    headerBorder: string;
    label: string;
    labelColor: string;
    textColor: string;
  },
): string {
  const cleanInner = inner.trim().replace(/^<p>/i, "").replace(/<\/p>$/i, "");
  return (
    `<table style="width:100%;border-collapse:collapse;margin:20px 0;border-radius:10px;border:1px solid ${options.border};background-color:${options.bg};overflow:hidden;">` +
    `<tr><td style="padding:10px 14px;background-color:${options.headerBg};border-bottom:1px solid ${options.headerBorder};border-left:none;border-right:none;border-top:none;">` +
    `<span style="font-size:17px;margin-right:6px;vertical-align:middle;">${icon}</span>` +
    `<span style="font-size:13px;font-weight:700;color:${options.labelColor};letter-spacing:0.06em;vertical-align:middle;">${options.label}</span>` +
    `</td></tr>` +
    `<tr><td style="padding:12px 14px 14px;font-size:15px;line-height:1.85;color:${options.textColor};text-align:justify;border:none;">${cleanInner}</td></tr>` +
    `</table>`
  );
}

/** 将「总结」章节正文包裹为 mp-summary（预览与推送共用） */
export function wrapSummarySection(html: string): string {
  if (/class="mp-summary"/i.test(html)) return html;

  return html.replace(
    /(<h2[^>]*>\s*总结\s*<\/h2>)([\s\S]*?)(?=\s*(?:<hr[\s/>]|<h2\b|$))/i,
    (_full, h2: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return h2 + body;
      return `${h2}<div class="mp-summary">${trimmed}</div>`;
    },
  );
}

function findFirstVisibleCharIndex(html: string): number {
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const close = html.indexOf(">", i);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    if (/\s/.test(html[i])) {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

/** 首段首字下沉：微信不支持 ::first-letter，用 float span 模拟 */
function applyDropCapToOpeningParagraph(html: string): string {
  const match = html.match(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/i);
  if (!match || match.index === undefined) return html;

  const full = match[0];
  const innerStart = html.indexOf(">", match.index) + 1;
  const innerEnd = match.index + full.length - "</p>".length;
  const inner = html.slice(innerStart, innerEnd);

  if (/float:left;font-size:52px|data-mp-dropcap/i.test(inner)) return html;

  const charIdx = findFirstVisibleCharIndex(inner);
  if (charIdx === -1) return html;

  const char = inner[charIdx];
  if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(char)) return html;

  const newInner =
    inner.slice(0, charIdx) +
    `<span style="${DROP_CAP_STYLE}">${char}</span>` +
    inner.slice(charIdx + 1);

  const openTag = html.slice(match.index, innerStart);
  const replacement = openTag + newInner + "</p>";
  return html.slice(0, match.index) + replacement + html.slice(match.index + full.length);
}

function buildSummaryBox(inner: string): string {
  const cleanInner = inner.trim();
  return (
    `<section style="margin:16px 0 24px;padding:18px 20px;background-color:${SUMMARY.bg};` +
    `border-left:4px solid ${SUMMARY.border};border-radius:0 10px 10px 0;` +
    `color:${SUMMARY.text};line-height:1.85;font-size:15px;text-align:justify;">${cleanInner}</section>`
  );
}

/**
 * 将文章 HTML 转换为微信公众号兼容的内联样式版本
 */
export function convertToWechatHtml(html: string): string {
  let result = wrapSummarySection(html);

  // ====== 0. 首段首字下沉（微信不支持 ::first-letter）======
  result = applyDropCapToOpeningParagraph(result);

  // ====== 1. mp-tip 提示卡片 → 蓝色背景卡片 + 💡 图标 ======
  result = result.replace(
    /<div class="mp-tip">([\s\S]*?)<\/div>/gi,
    (_full, inner: string) =>
      buildCalloutTable("💡", inner, {
        border: TIP.border,
        bg: TIP.bg,
        headerBg: TIP.headerBg,
        headerBorder: TIP.headerBorder,
        label: "实用技巧",
        labelColor: TIP.label,
        textColor: TIP.text,
      }),
  );

  // ====== 2. mp-warning 警告卡片 → 黄色背景卡片 + ⚠️ 图标 ======
  result = result.replace(
    /<div class="mp-warning">([\s\S]*?)<\/div>/gi,
    (_full, inner: string) =>
      buildCalloutTable("⚠️", inner, {
        border: WARN.border,
        bg: WARN.bg,
        headerBg: WARN.headerBg,
        headerBorder: WARN.headerBorder,
        label: "注意",
        labelColor: WARN.label,
        textColor: WARN.text,
      }),
  );

  // ====== 2b. mp-summary 总结卡片 → 浅蓝底 + 左侧蓝条 ======
  result = result.replace(
    /<div class="mp-summary">([\s\S]*?)<\/div>/gi,
    (_full, inner: string) => buildSummaryBox(inner),
  );

  // ====== 3. blockquote 引用块 ======
  result = result.replace(
    /<blockquote>([\s\S]*?)<\/blockquote>/gi,
    (_full, inner: string) => {
      const cleanInner = inner
        .replace(/^\s*<p>/i, "")
        .replace(/<\/p>\s*$/i, "");
      return (
        `<blockquote style="margin:26px 0;padding:20px 24px 20px 54px;background-color:${WARNING_BG};border-left:4px solid ${WARNING};border-radius:0 10px 10px 0;color:#5a4a2a;font-style:normal;position:relative;">` +
        `<span style="position:absolute;left:12px;top:2px;font-size:52px;color:rgba(231,169,59,0.25);font-family:Georgia,serif;line-height:1;">&#8220;</span>` +
        `<p style="margin:0;color:#5a4a2a;font-size:15.5px;line-height:1.85;">${cleanInner}</p>` +
        `</blockquote>`
      );
    },
  );

  // ====== 4. h2 章节标题 → 左侧蓝色竖线 ======
  result = result.replace(/<h2([^>]*)>/gi, (_full, attrs: string) => {
    return `<h2${attrs} style="font-size:20px;font-weight:700;line-height:1.5;margin:38px 0 16px;color:#1a1a1a;padding-left:16px;border-left:4px solid ${ACCENT};">`;
  });

  // ====== 5. h3 小节标题 → 左侧米色竖线 ======
  result = result.replace(/<h3([^>]*)>/gi, (_full, attrs: string) => {
    return `<h3${attrs} style="font-size:17px;font-weight:600;line-height:1.55;margin:26px 0 10px;color:#2a2a2a;padding-left:12px;border-left:3px solid #e6dccb;">`;
  });

  // ====== 6. strong 加粗（移至末尾再次统一处理，此处跳过）======

  // ====== 7. hr 分隔线 → 带装饰文本的分隔线 ======
  result = result.replace(/<hr\s*\/?>/gi, () => {
    return (
      `<section style="text-align:center;margin:36px 0;color:#c2b89e;font-size:14px;line-height:1;">` +
      `<span style="display:inline-block;width:100%;height:1px;background-color:#d4c9b0;vertical-align:middle;"></span>` +
      `<span style="display:inline-block;position:relative;top:-10px;background:#fff;padding:0 16px;">✦</span>` +
      `</section>`
    );
  });

  // ====== 8. ul 无序列表 → 标题+说明卡片 / 普通列表 ======
  result = transformListBlock(result, false);

  // ====== 9. ol 有序列表 → 标题+说明卡片 / 普通列表 ======
  result = transformListBlock(result, true);

  // ====== 10. img 图片 → 圆角 + 间距 ======
  result = result.replace(
    /<img([^>]*?)>/gi,
    (_full, attrs: string) => {
      // 避免重复添加 style，如果已有 style 则合并
      if (/style\s*=\s*["']/i.test(attrs)) {
        return `<img${attrs.replace(/(style\s*=\s*["'])/i, `$1max-width:100%;border-radius:8px;margin:20px 0;`)}>`;
      }
      return `<img${attrs} style="max-width:100%;border-radius:8px;margin:20px 0;">`;
    },
  );

  // ====== 11. figure / figcaption → 居中 + 图注样式 ======
  result = result.replace(/<figure([^>]*)>/gi, (_full, attrs: string) => {
    if (/style\s*=\s*["']/i.test(attrs)) {
      return `<figure${attrs.replace(/(style\s*=\s*["'])/i, `$1margin:24px 0;text-align:center;`)}>`;
    }
    return `<figure${attrs} style="margin:24px 0;text-align:center;">`;
  });
  result = result.replace(/<figcaption([^>]*)>/gi, (_full, attrs: string) => {
    if (/style\s*=\s*["']/i.test(attrs)) {
      return `<figcaption${attrs.replace(/(style\s*=\s*["'])/i, `$1font-size:13px;color:#aaaaaa;margin-top:10px;letter-spacing:0.04em;font-style:italic;`)}>`;
    }
    return `<figcaption${attrs} style="font-size:13px;color:#aaaaaa;margin-top:10px;letter-spacing:0.04em;font-style:italic;">`;
  });

  // ====== 12. 代码块 → 从源码重建，保持与预览相同的 section 结构（不转 table）======
  const cbOpen = /<section\s+data-mp-cb="1"/gi;
  let match: RegExpExecArray | null;
  const replacements: Array<{ original: string; replacement: string }> = [];

  while ((match = cbOpen.exec(result)) !== null) {
    const startIdx = match.index;
    const endIdx = findSectionBlockEnd(result, startIdx);
    if (endIdx === -1) continue;

    const fullBlock = result.slice(startIdx, endIdx);
    const tagEnd = result.indexOf(">", startIdx) + 1;
    const inner = result.slice(tagEnd, endIdx - "</section>".length);
    const { code } = parseCodeBlockSections(inner);
    const plainCode = highlightedCodeToPlainText(code);
    if (!plainCode.trim()) continue;

    replacements.push({ original: fullBlock, replacement: renderCodeBlockForWechat(plainCode) });
  }

  // 按位置倒序替换（避免偏移）
  for (let i = replacements.length - 1; i >= 0; i--) {
    result = result.replace(replacements[i].original, replacements[i].replacement);
  }

  // ====== 13. pre 代码块（老格式降级处理） ——
  // 如果数据库里有 <pre> 残留（手动编辑未经过 code-highlight），做一次换行转换
  result = result.replace(
    /<pre[^>]*>[\s\S]*?<\/pre>/gi,
    (block) => {
      block = block.replace(
        /(<code[^>]*>)([\s\S]*?)(<\/code>)/gi,
        (_codeMatch, openTag: string, codeContent: string, closeTag: string) => {
          return openTag + codeContent.replace(/\n/g, "<br>") + closeTag;
        },
      );
      return block;
    },
  );

  // ====== 14. code 行内代码 → 紫色背景（跳过代码块 section 内的 <code>）======
  const PROTECTED = "__MP_WECHAT_CODE__";
  result = result.replace(
    /<section data-mp-cb-body="1"[^>]*>[\s\S]*?<\/section>/gi,
    (block) => block.replace(/<code/g, `<code data-mp-w="${PROTECTED}"`),
  );
  result = result.replace(/<code>/gi, () => {
    return `<code style="padding:2px 4px;font-size:0.88em;color:#7c3aed;font-weight:500;font-family:SF Mono,Menlo,monospace;">`;
  });
  // 还原
  result = result.replace(
    new RegExp(`<code data-mp-w="${PROTECTED}`, "gi"),
    "<code",
  );

  // ====== 14. p 段落基础样式（跳过代码块 table 内的 <p>）======
  // 由于代码块转换后内部可能没有 <p>，这里只处理顶层段落
  result = result.replace(/<p>/gi, () => {
    return `<p style="margin:0 0 16px;color:#3d3d3d;text-align:justify;">`;
  });
  // 已有 style 的 p 合并
  result = result.replace(
    /<p style="([^"]*)"([^>]*)>/gi,
    (_full, existing: string, rest: string) => {
      if (existing.includes("margin")) {
        return `<p style="${existing}"${rest}>`;
      }
      return `<p style="margin:0 0 16px;color:#3d3d3d;text-align:justify;${existing}"${rest}>`;
    },
  );

  // ====== 15. 清理 mp-signature（不需要的尾部签名） ======
  result = result.replace(
    /<div class="mp-signature">[\s\S]*?<\/div>/gi,
    "",
  );

  // ====== 16. 移除空的 class 属性残留 ======
  result = result.replace(/\s+class="[^"]*"/gi, "");

  // ====== 17. strong / b 加粗（最后统一处理，确保微信可见）======
  result = applyStrongStyles(result);

  return result;
}
