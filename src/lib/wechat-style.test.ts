import { describe, expect, it } from "vitest";
import { convertToWechatHtml, enforceArticleHtmlFormat, normalizeArticleMarkup, normalizeCalloutBlocks, normalizeListHtml, prependWechatDigest } from "./wechat-style";

describe("normalizeListHtml", () => {
  it("flattens nested li tags", () => {
    const broken =
      "<ol><li><li><strong>标题</strong>说明文字</li><li><li><strong>标题二</strong>更多说明</li></ol>";

    const fixed = normalizeListHtml(broken);

    expect(fixed).not.toMatch(/<li>\s*<li>/i);
    expect(fixed).toContain("<li><strong>标题</strong>说明文字</li>");
  });
});

describe("normalizeCalloutBlocks", () => {
  it("merges bare text after empty mp-warning shell into the card", () => {
    const broken =
      '<p>前文</p>\n<div class="mp-warning">注意</div>不要试图用单个变量兼顾实时预览和路由同步。</p>\n<hr />\n<h2>下一节</h2>';

    const fixed = normalizeCalloutBlocks(broken);

    expect(fixed).toContain(
      '<div class="mp-warning"><p>不要试图用单个变量兼顾实时预览和路由同步。</p></div>',
    );
    expect(fixed).not.toMatch(/<\/div>不要试图/);
  });

  it("merges trailing p blocks after empty mp-warning shell", () => {
    const broken =
      '<div class="mp-warning">注意</div><p>第一段</p><p>第二段</p><hr />';

    const fixed = normalizeCalloutBlocks(broken);

    expect(fixed).toBe(
      '<div class="mp-warning"><p>第一段</p><p>第二段</p></div><hr />',
    );
  });

  it("converts markdown bold to strong tags", () => {
    const fixed = normalizeCalloutBlocks("<p>核心是**状态分离**策略。</p>");

    expect(fixed).toBe("<p>核心是<strong>状态分离</strong>策略。</p>");
  });

  it("fixes nested li inside mp-tip", () => {
    const broken =
      '<div class="mp-tip"><ol><li><li><strong>建立查询权重分级</strong>说明一</li><li><li><strong>实现混合提交模式</strong>说明二</li></ol></div>';

    const fixed = normalizeCalloutBlocks(broken);

    expect(fixed).not.toMatch(/<li>\s*<li>/i);
  });
});

describe("enforceArticleHtmlFormat", () => {
  it("converts mp-tip ul and paragraphs to a single ol matching body list format", () => {
    const broken =
      '<div class="mp-tip"><ul><li><strong>配置序列化器</strong>挂载函数</li></ul></div>';
    const fixed = enforceArticleHtmlFormat(broken);

    expect(fixed).toBe(
      '<div class="mp-tip"><ol><li><strong>配置序列化器</strong>挂载函数</li></ol></div>',
    );
  });

  it("converts mp-tip paragraph steps to ol items", () => {
    const broken =
      '<div class="mp-tip"><p><strong>步骤一</strong>先做这件事</p><p><strong>步骤二</strong>再做那件事</p></div>';
    const fixed = enforceArticleHtmlFormat(broken);

    expect(fixed).toContain("<ol>");
    expect(fixed).toContain("<li><strong>步骤一</strong>先做这件事</li>");
    expect(fixed).toContain("<li><strong>步骤二</strong>再做那件事</li>");
    expect(fixed).not.toMatch(/<p>/);
  });

  it("converts mp-warning lists to paragraphs", () => {
    const broken =
      '<div class="mp-warning"><ul><li><strong>误区</strong>不要混用状态</li></ul></div>';
    const fixed = enforceArticleHtmlFormat(broken);

    expect(fixed).toBe(
      '<div class="mp-warning"><p><strong>误区</strong>不要混用状态</p></div>',
    );
  });
});

describe("prependWechatDigest", () => {
  it("inserts digest block before article body", () => {
    const digest = "从依赖选型到参数序列化，拆解搜索表单底层逻辑。";
    const body = "<p>很多团队把搜索表单当成复制粘贴件。</p>";
    const result = prependWechatDigest(body, digest);

    expect(result.startsWith("<section")).toBe(true);
    expect(result).toContain(digest);
    expect(result).toContain(body);
  });

  it("skips duplicate digest already at content start", () => {
    const digest = "同一段摘要";
    const body = "<p>同一段摘要</p><p>正文</p>";
    expect(prependWechatDigest(body, digest)).toBe(body);
  });
});

describe("convertToWechatHtml", () => {
  it("renders mp-tip ordered steps with the same list layout as body ol", () => {
    const stepList =
      "<ol><li><strong>步骤一</strong>先做这件事</li><li><strong>步骤二</strong>再做那件事</li></ol>";
    const bodyWechat = convertToWechatHtml(stepList);
    const tipWechat = convertToWechatHtml(`<div class="mp-tip">${stepList}</div>`);

    expect(tipWechat).not.toMatch(/<ol/i);
    expect(tipWechat).not.toMatch(/<li/i);
    expect(tipWechat).toContain("步骤一");
    expect(tipWechat).toContain("实用技巧");
    expect(tipWechat).toContain(bodyWechat);
    expect(tipWechat).toMatch(/实用技巧<\/span><\/td><\/tr><\/table><div style="margin:14px 0 20px;"/);
  });

  it("converts figure to single img section for wechat (no figcaption)", () => {
    const html =
      '<h2>标题</h2><figure data-progress="1/3"><img src="https://example.com/a.jpg" alt="标题" /><figcaption>标题</figcaption></figure>';

    const wechat = convertToWechatHtml(html);

    expect(wechat).not.toMatch(/<figure/i);
    expect(wechat).not.toMatch(/figcaption/i);
    expect(wechat).toMatch(/<img[^>]+example\.com\/a\.jpg/i);
  });

  it("renders hr as a text-only WeChat-safe divider (no table boxes)", () => {
    const wechat = convertToWechatHtml("<p>上</p><hr /><h2>下</h2>");

    expect(wechat).not.toMatch(/<hr/i);
    expect(wechat).not.toMatch(/<table/i);
    expect(wechat).not.toMatch(/border-bottom/i);
    expect(wechat).not.toMatch(/position:\s*(absolute|relative)/i);
    expect(wechat).not.toMatch(/linear-gradient/i);
    expect(wechat).toContain("✦");
    expect(wechat).toContain("────────");
    expect(wechat).toContain("#b9a88c");
  });

  it("styles bare data tables with inline styles and drops thead/tbody", () => {
    const html =
      "<table><thead><tr><th>场景</th><th>QPS</th></tr></thead><tbody><tr><td>A</td><td>1850</td></tr></tbody></table>";

    const wechat = convertToWechatHtml(html);

    expect(wechat).not.toMatch(/<thead|<\/thead|<tbody|<\/tbody/i);
    expect(wechat).toMatch(
      /<table style="width:100%;table-layout:fixed;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;word-break:break-word;overflow-wrap:break-word;">/,
    );
    expect(wechat).toMatch(
      /<th style="background-color:#3e7bfa;color:#ffffff;padding:10px 12px;/,
    );
    expect(wechat).toMatch(
      /<td style="padding:10px 12px;font-size:14px;line-height:1.7;color:#3d3d3d;border:1px solid #e5e7eb;word-break:break-word;overflow-wrap:break-word;">/,
    );
    expect(wechat).toContain("场景");
    expect(wechat).toContain("1850");
  });

  it("wraps table cells instead of clipping (no white-space:nowrap on th)", () => {
    const html = "<table><tr><th>场景</th><th>QPS</th></tr><tr><td>A</td><td>1850</td></tr></table>";
    const wechat = convertToWechatHtml(html);

    expect(wechat).not.toMatch(/white-space:nowrap/);
    expect(wechat).toMatch(/table-layout:fixed/);
    expect(wechat).toMatch(/word-break:break-word/);
  });

  it("applies zebra stripes to even data rows of styled data tables", () => {
    const html =
      "<table><tr><th>场景</th><th>QPS</th></tr><tr><td>A</td><td>1850</td></tr><tr><td>B</td><td>900</td></tr><tr><td>C</td><td>600</td></tr></table>";
    const wechat = convertToWechatHtml(html);

    // 第 2 行（rowIndex 2，偶数数据行）有浅灰底，第 1/3 数据行无底
    expect(wechat).toMatch(/background-color:#f1f5f9;padding:10px 12px/);
    const dataRows = wechat.match(/<td style="(?:background-color:#f1f5f9;)?padding:10px 12px;/g) ?? [];
    expect(dataRows.length).toBe(6);
    expect(dataRows.filter((r) => r.includes("#f1f5f9")).length).toBe(2);
  });

  it("renders blockquote as a WeChat-safe table layout without position:absolute", () => {
    const html = "<blockquote><p>先想清楚再动手，代码只是表达。</p></blockquote>";
    const wechat = convertToWechatHtml(html);

    expect(wechat).not.toMatch(/position:\s*(absolute|relative)/i);
    expect(wechat).toMatch(/<table style="width:100%;border-collapse:collapse;margin:26px 0;background-color:#fff8eb;/);
    expect(wechat).toMatch(/&#8220;/);
    expect(wechat).toContain("先想清楚再动手，代码只是表达。");
  });

  it("keeps code lines in a horizontally scrollable container for WeChat (nowrap + overflow:auto)", () => {
    const codeBlock = '<section data-mp-cb="1"><section data-mp-cb-lang="1">Bash</section><section data-mp-cb-body="1"><span>npx ts-migrate migrate --decorators --transforms experimentalDecorators --suffix .ts --src src</span></section></section>';
    const wechat = convertToWechatHtml(codeBlock);

    expect(wechat).toContain("white-space:nowrap");
    expect(wechat).toContain("overflow-x:auto");
    expect(wechat).not.toContain("max-height:420px");
    expect(wechat).not.toContain("white-space:pre-wrap");
    // 终端命令不再被误标为 CSS
    expect(wechat).toMatch(/data-mp-cb-lang="1"[^>]*>Bash<\/p>/);
  });

  it("replaces empty code blocks with a placeholder instead of a broken black box", () => {
    const codeBlock = '<section data-mp-cb="1"><section data-mp-cb-lang="1">CSS</section><section data-mp-cb-body="1"></section></section>';
    const wechat = convertToWechatHtml(codeBlock);

    expect(wechat).toContain("此处无代码内容");
  });

  it("does not double-style list-card tables that already carry inline styles", () => {
    const card =
      '<table style="width:100%;border-collapse:collapse;margin:0 0 12px;border:1px solid #dbeafe;"><tr><td style="padding:14px 16px;border:none;">正文</td></tr></table>';

    const wechat = convertToWechatHtml(card);

    // 已有 style 的 table/td 保持原样，不被 12b 覆盖
    expect(wechat).toContain('border:1px solid #dbeafe;');
    expect(wechat).not.toContain("border:1px solid #e5e7eb;");
    expect(wechat).not.toMatch(/<td style="padding:10px 12px;font-size:14px;/);
  });

  it("extracts code blocks out of list cards so they stay scrollable (no flattening inside the card)", () => {
    const code = "def check_format(data):\n  if not re.match(r'^OD\\d{12}', data):\n    return True";
    const html =
      "<ol><li><strong>数据格式校验</strong>匹配业务规则，伪代码：" +
      `<pre><code class="language-python">${code}</code></pre>` +
      "命令自动生效。</li></ol>";

    const wechat = convertToWechatHtml(html);

    // 卡片（table）内不再出现代码块
    const cards = wechat.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card).not.toMatch(/data-mp-cb|<pre|<code/i);
    }
    // 代码块独立在卡片外，多行保留 <br> 换行，缩进不丢
    expect(wechat).toMatch(/<\/table><pre/);
    expect(wechat).toContain("def check_format(data):<br>  if not re.match");
    // 卡片内不留 __MP_LI_CB_ 占位符（伪代码位置用空白分隔）
    expect(wechat).not.toContain("__MP_LI_CB_");
    // 列表文字仍保留
    expect(wechat).toContain("数据格式校验");
    expect(wechat).toContain("命令自动生效");
  });

  it("extracts already-highlighted code blocks out of list cards", () => {
    const cb =
      '<section data-mp-cb="1"><section data-mp-cb-lang="1">Bash</section><section data-mp-cb-body="1"><span>npx ts-migrate migrate --decorators</span></section></section>';
    const html = `<ol><li><strong>第一步</strong>执行迁移命令：${cb}命令自动转换。</li></ol>`;

    const wechat = convertToWechatHtml(html);

    const cards = wechat.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? [];
    for (const card of cards) {
      expect(card).not.toMatch(/data-mp-cb/i);
    }
    expect(wechat).toMatch(/<\/table><section data-mp-cb="1"/);
    expect(wechat).toMatch(/data-mp-cb-lang="1"[^>]*>Bash<\/p>/);
  });

  it("strips AI-invented container backgrounds so list cards are not stacked (no card-in-card)", () => {
    const html =
      "<p>前文</p>" +
      '<div style="background-color:#f0f4ff;border-radius:12px;padding:18px 20px;margin:24px 0;box-shadow:0 2px 8px rgba(0,0,0,0.05);">' +
      "<h3>验证层核心3项规则配置</h3>" +
      "<ul><li><strong>商品ID校验</strong>固定调用接口，仅允许返回200/404状态</li>" +
      "<li><strong>相关信息校验</strong>必填字段缺失则拦截</li></ul>" +
      "</div>" +
      "<p>后文</p>";

    const wechat = convertToWechatHtml(html);

    // AI 自创 div 的视觉样式被剥掉（退化为无样式容器，无背景/边框残留）
    expect(wechat).not.toContain("#f0f4ff");
    expect(wechat).not.toMatch(/<div style="[^"]*(?:background|border|padding)/);
    // 列表卡片独立存在，不套在任何外层背景里
    expect(wechat).toMatch(/border-left:4px solid #3e7bfa;background-color:#f8fbff/);
    // 文字保留
    expect(wechat).toContain("验证层核心3项规则配置");
    expect(wechat).toContain("商品ID校验");
  });

  it("strips AI containers with single-quoted style too (common AI output)", () => {
    const html =
      "<p>前文</p>" +
      "<div style='background-color:#eef2f7;border-radius:12px;padding:16px 18px;'>" +
      "<h3>验证层配置项（3项）</h3>" +
      "<ul><li><strong>业务字段校验阈值</strong>空值拦截率≥90%</li></ul>" +
      "</div>" +
      "<p>后文</p>";

    const wechat = convertToWechatHtml(html);

    // 单引号 style 的 AI 容器同样被剥掉，不出现「卡片套卡片」
    expect(wechat).not.toContain("#eef2f7");
    expect(wechat).not.toMatch(/<div style="[^"]*(?:background|border|padding)/i);
    expect(wechat).toMatch(/border-left:4px solid #3e7bfa;background-color:#f8fbff/);
    expect(wechat).toContain("验证层配置项（3项）");
  });

  it("keeps system structures (mp-tip, code blocks) untouched by style stripping", () => {
    const html =
      '<div class="mp-tip"><ol><li><strong>步骤一</strong>先做这件事</li></ol></div>' +
      '<section data-mp-cb="1" style="border-radius:8px;border:1px solid #30363d;background-color:#0d1117;"><section data-mp-cb-lang="1" style="padding:8px 14px;">Bash</section></section>';

    const wechat = convertToWechatHtml(html);

    expect(wechat).toContain("实用技巧");
    expect(wechat).toContain("background-color:#0d1117");
    expect(wechat).toContain("border:1px solid #30363d");
  });

  it("pulls lists out of mp-summary so the summary box does not wrap list cards", () => {
    const html =
      "<h2>总结</h2><div class=\"mp-summary\"><p>要点回顾。</p><ul><li><strong>要点一</strong>说明一</li></ul></div>";

    const wechat = convertToWechatHtml(html);

    expect(wechat).toContain("要点回顾。");
    expect(wechat).toMatch(/<section style="margin:16px 0 24px;padding:18px 20px;background-color:#f0f4ff;/);
    expect(wechat).toMatch(/border-left:4px solid #3e7bfa;background-color:#f8fbff/);
  });

  it("extracts lists mistakenly written inside code blocks (no dark-card-wraps-white-card)", () => {
    // AI 违规把配置清单写进 <pre><code>
    const html =
      "<p>伪代码示例：</p>" +
      "<pre><code class=\"language-python\"># 重试配置\nmax_retries = 3</code></pre>" +
      "<ol><li><strong>最大重试次数</strong>3次</li><li><strong>基础重试间隔</strong>1-3秒</li></ol>";

    const wechat = convertToWechatHtml(html);

    // 列表卡片在代码块外（兄弟关系），代码块内不出现卡片
    expect(wechat).toMatch(/<\/pre><div style="margin:14px 0 20px;"><table/);
    expect(wechat).toMatch(/background-color:#f8fbff/);
    expect(wechat).toContain("最大重试次数");
  });

  it("extracts lists from inside highlighted code block bodies", () => {
    const html =
      '<section data-mp-cb="1" style="background-color:#0d1117;">' +
      '<section data-mp-cb-lang="1">Python</section>' +
      '<section data-mp-cb-body="1" style="padding:12px;">' +
      '<p style="margin:0;"># 配置</p>' +
      "<ul><li><strong>最大重试次数</strong>3次</li><li><strong>基础重试间隔</strong>1-3秒</li></ul>" +
      "</section></section>";

    const wechat = convertToWechatHtml(html);

    // 卡片 table 不在代码块 section 内部，代码块后跟列表卡片容器
    const cbBlock = wechat.match(/<section data-mp-cb="1"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(cbBlock).not.toMatch(/<table/);
    expect(wechat).toMatch(/<\/section><div style="margin:14px 0 20px;"><table/);
    expect(wechat).toContain("最大重试次数");
  });

  it("extracts escaped list text (&lt;ol&gt;) mistakenly written inside code blocks", () => {
    // AI 把含 HTML 标签的配置清单写进代码块，hljs 高亮后转义成 &lt;ol&gt; 实体文本；
    // 微信会把实体解码成真标签渲染成列表。防御应把这些转义文本解码并提取到代码块外。
    const cbBody =
      "<p># 配置</p>" +
      "&lt;ol&gt;&lt;li&gt;&lt;strong&gt;订单ID校验规则&lt;/strong&gt;&lt;code&gt;^\\\\d{10}$&lt;/code&gt;&lt;/li&gt;" +
      "&lt;li&gt;&lt;strong&gt;金额校验规则&lt;/strong&gt;&lt;code&gt;^\\\\d+\\\\.\\\\d{2}$&lt;/code&gt;&lt;/li&gt;&lt;/ol&gt;";
    const html =
      '<section data-mp-cb="1" style="background-color:#0d1117;">' +
      '<section data-mp-cb-lang="1">Python</section>' +
      `<section data-mp-cb-body="1" style="padding:12px;">${cbBody}</section>` +
      "</section>";

    const wechat = convertToWechatHtml(html);

    // 代码块 body（平级 p 行）内不再残留转义的列表文本
    const cbBodyOut = wechat.match(/<p data-mp-cb-body="1"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(cbBodyOut).not.toMatch(/&lt;ol/i);
    // 列表被提取到代码块外并按卡片渲染
    expect(wechat).toMatch(/background-color:#f8fbff/);
    expect(wechat).toContain("订单ID校验规则");
    expect(wechat).toContain("金额校验规则");
    // 代码块本身仍保留纯代码
    expect(wechat).toContain("# 配置");
  });

  it("fixes unclosed code lines so WeChat does not swallow following content", () => {
    // AI 生成的代码行 p 未闭合（字符串被截断），会把后续正文吞进代码块。
    // fixUnclosedTags 应补上闭合，正文保持在代码块外，输出标签平衡。
    const html =
      "<h2>第一层拦截</h2>" +
      '<section data-mp-cb="1" style="background-color:#0d1117;">' +
      '<section data-mp-cb-lang="1">Python</section>' +
      '<section data-mp-cb-body="1" style="padding:12px;">' +
      "<p style=\"margin:0;\">def validate_agent_output(output):</p>" +
      "<p style=\"margin:0;\"><span>address_pattern = </span><span style=\"color:#a5d6ff;\">r'^[省市区]+[市辖区]+[街道]+\\d号+" +
      "</section></section>" +
      "<p>上述规则的边界明确，无模糊空间。</p>" +
      "<h2>容错兜底</h2><p>后续内容。</p>";

    const wechat = convertToWechatHtml(html);

    // 标签平衡（无未闭合）
    const pOpen = (wechat.match(/<p[\s>]/g) ?? []).length;
    const pClose = (wechat.match(/<\/p>/g) ?? []).length;
    const spanOpen = (wechat.match(/<span/g) ?? []).length;
    const spanClose = (wechat.match(/<\/span>/g) ?? []).length;
    expect(pOpen).toBe(pClose);
    expect(spanOpen).toBe(spanClose);
    // 正文在代码块外
    const cb = wechat.match(/<section data-mp-cb="1"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(cb).not.toContain("上述规则");
    expect(wechat.indexOf("上述规则的边界明确")).toBeGreaterThan(wechat.indexOf("</section>", wechat.indexOf("data-mp-cb")));
    // 代码内容保留
    expect(cb).toContain("address_pattern");
    expect(wechat).toContain("容错兜底");
  });
});

describe("normalizeArticleMarkup", () => {
  it("fixes div.blockquote and strips figcaption from system figures", () => {
    const html =
      '<div class="blockquote"><p>引用</p></div><figure data-progress="1/1"><img src="https://x.com/1.jpg" /><figcaption>说明</figcaption></figure>';

    const fixed = normalizeArticleMarkup(html);

    expect(fixed).toContain("<blockquote>");
    expect(fixed).not.toContain("figcaption");
    expect(fixed).not.toContain('div class="blockquote"');
  });
});
