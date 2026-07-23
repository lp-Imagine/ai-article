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
    const { html } = convertImportedContent("<p>你好</p><p>世界</p>");
    expect(html.toLowerCase()).toContain("<p>");
    expect(plainTextLengthFromHtml(html)).toBeGreaterThan(0);
  });
});
