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

const ACCENT = "#3e7bfa";
const WARNING = "#e7a93b";
const ACCENT_BG = "rgba(62,123,250,0.06)";
const WARNING_BG = "rgba(231,169,59,0.08)";

/**
 * 将文章 HTML 转换为微信公众号兼容的内联样式版本
 */
export function convertToWechatHtml(html: string): string {
  let result = html;

  // ====== 1. mp-tip 提示卡片 → 蓝色背景卡片 + 💡 图标 ======
  result = result.replace(
    /<div class="mp-tip">([\s\S]*?)<\/div>/gi,
    (_full, inner: string) => {
      return (
        `<section style="margin:22px 0;padding:18px 22px 18px 48px;background-color:${ACCENT_BG};border-radius:10px;border:1px solid rgba(62,123,250,0.15);font-size:15px;color:#2a4a8a;position:relative;">` +
        `<span style="position:absolute;left:16px;top:18px;font-size:18px;">💡</span>` +
        inner.trim() +
        `</section>`
      );
    },
  );

  // ====== 2. mp-warning 警告卡片 → 黄色背景卡片 + ⚠️ 图标 ======
  result = result.replace(
    /<div class="mp-warning">([\s\S]*?)<\/div>/gi,
    (_full, inner: string) => {
      return (
        `<section style="margin:22px 0;padding:18px 22px 18px 48px;background-color:${WARNING_BG};border-radius:10px;border:1px solid rgba(231,169,59,0.2);font-size:15px;color:#6b4a0a;position:relative;">` +
        `<span style="position:absolute;left:16px;top:18px;font-size:18px;">⚠️</span>` +
        inner.trim() +
        `</section>`
      );
    },
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

  // ====== 6. strong 加粗 ======
  result = result.replace(/<strong>/gi, () => {
    return `<strong style="color:#1a1a1a;font-weight:700;">`;
  });

  // ====== 7. hr 分隔线 → 带装饰文本的分隔线 ======
  result = result.replace(/<hr\s*\/?>/gi, () => {
    return (
      `<section style="text-align:center;margin:36px 0;color:#c2b89e;font-size:14px;line-height:1;">` +
      `<span style="display:inline-block;width:100%;height:1px;background-color:#d4c9b0;vertical-align:middle;"></span>` +
      `<span style="display:inline-block;position:relative;top:-10px;background:#fff;padding:0 16px;">✦</span>` +
      `</section>`
    );
  });

  // ====== 8. ul 无序列表 → 菱形标记替换 ======
  // 将每个 <li> 内容前加上 ▸ 符号，并用内联样式模拟菱形
  result = result.replace(/<ul>/gi, () => {
    return `<ul style="padding-left:0;margin:14px 0 20px;list-style:none;">`;
  });
  result = result.replace(
    /<ul[^>]*>([\s\S]*?)<\/ul>/gi,
    (_full, inner: string) => {
      const fixed = inner.replace(
        /<li>([\s\S]*?)<\/li>/gi,
        (_li, liInner: string) => {
          return `<li style="padding:7px 0 7px 30px;margin-bottom:8px;position:relative;color:#3a3a3a;line-height:1.8;"><span style="position:absolute;left:6px;top:15px;display:inline-block;width:8px;height:8px;background-color:${ACCENT};border-radius:2px;opacity:0.6;"></span>${liInner.trim()}</li>`;
        },
      );
      return `<ul style="padding-left:0;margin:14px 0 20px;list-style:none;">${fixed}</ul>`;
    },
  );

  // ====== 9. ol 有序列表 → 蓝底圆形数字标记 ======
  // 微信不支持 counter-reset，将数字硬编码
  result = result.replace(/<ol>/gi, () => {
    return `<ol style="padding-left:0;margin:14px 0 20px;list-style:none;">`;
  });
  result = result.replace(
    /<ol[^>]*>([\s\S]*?)<\/ol>/gi,
    (_full, inner: string) => {
      let counter = 0;
      const fixed = inner.replace(
        /<li>([\s\S]*?)<\/li>/gi,
        (_li, liInner: string) => {
          counter++;
          return `<li style="padding:8px 0 8px 38px;margin-bottom:8px;position:relative;color:#3a3a3a;line-height:1.8;"><span style="position:absolute;left:0;top:8px;display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:${ACCENT};color:#fff;border-radius:50%;font-size:13px;font-weight:700;">${counter}</span>${liInner.trim()}</li>`;
        },
      );
      return `<ol style="padding-left:0;margin:14px 0 20px;list-style:none;">${fixed}</ol>`;
    },
  );

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

  // ====== 12. GitHub 风格代码块 → 转换为微信 table 结构 =====
  // 用 data-mp-cb 标记精确匹配完整嵌套结构（非贪婪正则无法处理嵌套 section）
  const cbOpen = /<section data-mp-cb="1" style="[^"]*">/gi;
  let match: RegExpExecArray | null;
  const replacements: Array<{ original: string; replacement: string }> = [];

  // 手动计数嵌套 depth 来找到完整代码块
  const openPattern = /<section\b/gi;
  const closePattern = /<\/section>/gi;
  while ((match = cbOpen.exec(result)) !== null) {
    const startIdx = match.index;
    // 从外层 section 的 > 之后开始计数
    const tagEnd = result.indexOf(">", startIdx) + 1;
    let depth = 1;
    let pos = tagEnd;
    while (depth > 0 && pos < result.length) {
      openPattern.lastIndex = pos;
      closePattern.lastIndex = pos;
      const nextOpen = openPattern.exec(result);
      const nextClose = closePattern.exec(result);
      if (!nextClose) break;
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        pos = nextOpen.index + 1;
      } else {
        depth--;
        pos = nextClose.index + 1;
        if (depth === 0) {
          const fullBlock = result.slice(startIdx, pos);
          const inner = result.slice(tagEnd, nextClose.index);
          // 提取语言栏
          const langMatch2 = inner.match(/<section[^>]*>([\s\S]*?)<\/section>/i);
          const lang = (langMatch2 ? langMatch2[1].trim() : "Code").replace(/<[^>]+>/g, "").trim() || "Code";
          // 提取代码区（第二个 section）
          const codeMatch2 = inner.match(/<section[^>]*>([\s\S]*?)<\/section>(?![\s\S]*?<\/section>)/i);
          const codeContent = codeMatch2 ? codeMatch2[1] : inner;
          const replacement =
            `<table style="border-collapse:collapse;width:auto;max-width:100%;border-radius:6px;overflow:hidden;margin:16px 0;font-family:SF Mono,Menlo,Consolas,monospace;table-layout:fixed;">` +
              `<tr><td style="padding:6px 14px;background-color:#eaeef2;color:#57606a;font-size:12px;letter-spacing:0.05em;border-top:1px solid #d0d7de;border-left:1px solid #d0d7de;border-right:1px solid #d0d7de;font-weight:600;">${lang}</td></tr>` +
              `<tr><td style="padding:0;background-color:#f6f8fa;border:1px solid #d0d7de;border-top:none;vertical-align:top;"><section style="padding:12px 14px;font-size:13px;line-height:1.6;color:#24292f;max-height:420px;overflow:auto;white-space:nowrap;">${codeContent}</section></td></tr>` +
            `</table>`;
          replacements.push({ original: fullBlock, replacement });
        }
      }
    }
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

  // ====== 14. code 行内代码 → 紫色背景（跳过代码块 table 内的 <code>）======
  // 使用 placeholder 标记已转成 table 的代码块内的 <code>，不修改它们
  const PROTECTED = "__MP_WECHAT_CODE__";
  result = result.replace(
    /<table[^>]*overflow:hidden;margin:16px 0;[^>]*>[\s\S]*?<\/table>/gi,
    (match) => match.replace(/<code/g, `<code data-mp-w="${PROTECTED}"`),
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

  return result;
}
