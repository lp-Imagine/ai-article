import { describe, expect, it } from "vitest";
import {
  convertImportedContent,
  looksLikeHtml,
  markdownOrPlainToHtml,
  plainTextLengthFromHtml,
} from "./import-content";

describe("looksLikeHtml", () => {
  it("detects multi-tag HTML", () => {
    expect(looksLikeHtml("<p>你好</p><p>世界</p>")).toBe(true);
  });

  it("treats plain prose as non-html", () => {
    expect(looksLikeHtml("这是一段普通文字，没有标签。")).toBe(false);
  });
});

describe("markdownOrPlainToHtml", () => {
  it("wraps paragraphs and converts bold", () => {
    const html = markdownOrPlainToHtml("第一段\n\n第二段有**重点**");
    expect(html).toContain("<p>第一段</p>");
    expect(html).toContain("<strong>重点</strong>");
  });

  it("converts headings and lists", () => {
    const html = markdownOrPlainToHtml("# 大标题\n\n- 甲\n- 乙\n\n1. 一\n2. 二");
    expect(html).toContain("<h2>大标题</h2>");
    expect(html).toContain("<ul><li>甲</li><li>乙</li></ul>");
    expect(html).toContain("<ol><li>一</li><li>二</li></ol>");
  });

  it("escapes raw angle brackets in plain text", () => {
    const html = markdownOrPlainToHtml("比较 a < b 与 c > d");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).not.toMatch(/<b\b/i);
  });

  it("converts fenced code blocks", () => {
    const html = markdownOrPlainToHtml("前文\n\n```js\nconst a = 1;\n```\n\n后文");
    expect(html).toContain('<pre><code class="language-js">const a = 1;</code></pre>');
    expect(html).toContain("<p>前文</p>");
    expect(html).toContain("<p>后文</p>");
  });
});

describe("convertImportedContent", () => {
  it("rejects empty input", () => {
    expect(() => convertImportedContent("   ")).toThrow("请粘贴正文内容");
  });

  it("imports markdown body", () => {
    const { html, wordCount } = convertImportedContent("## 小节\n\n正文内容");
    expect(html).toContain("<h2>小节</h2>");
    expect(wordCount).toBeGreaterThan(0);
  });

  it("imports simple HTML via cleanup pipeline", () => {
    const { html, sourceKind } = convertImportedContent("<p>你好</p><p>世界</p>");
    expect(sourceKind).toBe("html");
    expect(html.toLowerCase()).toContain("<p>");
    expect(plainTextLengthFromHtml(html)).toBeGreaterThan(0);
  });

  it("extracts body from full HTML documents", () => {
    const page = `<!doctype html><html><head><title>x</title></head><body>
      <article><p>${"正文内容。".repeat(30)}</p></article>
      <footer>页脚</footer></body></html>`;
    const { html, sourceKind } = convertImportedContent(page);
    expect(sourceKind).toBe("html");
    expect(html).toContain("正文内容");
    expect(html).not.toContain("页脚");
  });

  it("extracts nested article blocks without truncating at inner div", () => {
    const page = `<!doctype html><html><body>
      <div class="post-content">
        <p>引言段落</p>
        <div class="code-wrap">
          <span>content-script.js</span>
          <pre><code>chrome.runtime.onMessage.addListener(() =&gt; {});</code></pre>
        </div>
        <p>代码块之后的段落不应丢失</p>
      </div>
      <footer>页脚</footer>
    </body></html>`;
    const { html } = convertImportedContent(page);
    expect(html).toContain("引言段落");
    expect(html).toContain("content-script.js");
    expect(html).toContain("chrome.runtime");
    expect(html).toContain("代码块之后的段落不应丢失");
    expect(html).not.toContain("页脚");
  });

  it("preserves script examples inside pre/code when stripping page chrome", async () => {
    const { extractArticleFromHtmlPage } = await import("./import-content");
    const page = `<!doctype html><html><body>
      <article>
        <blockquote>双方通信直接发送 JSON 对象</blockquote>
        <h2>content-script &amp;&amp; background</h2>
        <pre><code class="language-js">// content-script.js
<script src="content-script.js"></script>
chrome.runtime.onMessage.addListener(() => {});
</code></pre>
        <p>后续章节内容完整保留</p>
      </article>
      <script>analytics();</script>
    </body></html>`;
    const out = extractArticleFromHtmlPage(page);
    expect(out.content).toContain("content-script.js");
    expect(out.content).toContain("chrome.runtime");
    expect(out.content).toContain("后续章节内容完整保留");
    expect(out.content).not.toContain("analytics");
  });
});

describe("extractTitleFromContent", () => {
  it("reads markdown heading", async () => {
    const { extractTitleFromContent } = await import("./import-content");
    expect(extractTitleFromContent("# Hello World\n\n正文")).toBe("Hello World");
  });
});

describe("extractArticleFromHtmlPage", () => {
  it("extracts wechat-like article block", async () => {
    const { extractArticleFromHtmlPage } = await import("./import-content");
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="测试标题" />
      <meta name="description" content="这是摘要说明文字" />
      <title>忽略</title></head><body>
      <div id="js_content"><p>${"正文段落。".repeat(20)}</p><p>第二段内容足够长。</p></div>
      </body></html>`;
    const out = extractArticleFromHtmlPage(html);
    expect(out.title).toBe("测试标题");
    expect(out.summary).toContain("摘要");
    expect(out.content).toContain("正文段落");
  });
});

describe("assertSafeImportUrl", () => {
  it("rejects localhost", async () => {
    const { assertSafeImportUrl, ImportContentError } = await import("./import-content");
    expect(() => assertSafeImportUrl("http://localhost/x")).toThrow(ImportContentError);
    expect(() => assertSafeImportUrl("http://127.0.0.1/x")).toThrow(ImportContentError);
  });

  it("accepts https public urls", async () => {
    const { assertSafeImportUrl } = await import("./import-content");
    expect(assertSafeImportUrl("https://example.com/a").hostname).toBe("example.com");
  });
});
