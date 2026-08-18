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
    expect(tipWechat).toMatch(/实用技巧<\/span><\/td><\/tr><\/table><section style="margin:14px 0 20px;"/);
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

  it("wraps code block lines for WeChat (pre-wrap + overflow-wrap, no nowrap)", () => {
    const codeBlock = '<section data-mp-cb="1"><section data-mp-cb-lang="1">Bash</section><section data-mp-cb-body="1"><span>npx ts-migrate migrate --decorators --transforms experimentalDecorators --suffix .ts --src src</span></section></section>';
    const wechat = convertToWechatHtml(codeBlock);

    expect(wechat).toContain("white-space:pre-wrap");
    expect(wechat).toContain("overflow-wrap:break-word");
    expect(wechat).not.toContain("white-space:nowrap");
    expect(wechat).not.toContain("max-height:420px");
    // 终端命令不再被误标为 CSS
    expect(wechat).toMatch(/data-mp-cb-lang="1"[^>]*>Bash<\/section>/);
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
