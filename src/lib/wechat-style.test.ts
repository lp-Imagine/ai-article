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
