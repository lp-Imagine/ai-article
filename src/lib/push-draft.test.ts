import { describe, expect, it } from "vitest";
import { dedupeWholeArticleContent, extractFirstImageSrc } from "./push-draft";

describe("extractFirstImageSrc", () => {
  it("returns the first real image src", () => {
    const html =
      '<p>开头</p><img src="https://cdn.example.com/a.png" alt="x" /><img src="https://cdn.example.com/b.png" />';
    expect(extractFirstImageSrc(html)).toBe("https://cdn.example.com/a.png");
  });

  it("skips placeholder images and data URIs", () => {
    const html =
      '<img src="https://placehold.co/1200x630" /><img src="data:image/png;base64,xx" /><img src="https://cdn.example.com/real.png" />';
    expect(extractFirstImageSrc(html)).toBe("https://cdn.example.com/real.png");
  });

  it("returns null when there is no usable image", () => {
    expect(extractFirstImageSrc("<p>纯文本</p>")).toBeNull();
    expect(extractFirstImageSrc('<img src="https://placehold.co/1200x630" />')).toBeNull();
    expect(extractFirstImageSrc("")).toBeNull();
  });
});

describe("dedupeWholeArticleContent", () => {
  const onePass =
    "<h2>第一章</h2><p>这是第一章的内容，讲解原理与做法，字数足够长以通过最小长度检测。</p>" +
    "<h2>第二章</h2><p>这是第二章的内容，讲解应用与案例，同样有足够的字数来支撑判断。</p>";

  it("removes the duplicated second half when the article body appears twice", () => {
    const dup = `<p>开篇段落，交代背景与目标。</p>${onePass}<hr />${onePass}`;
    const result = dedupeWholeArticleContent(dup);

    expect(result).toContain("开篇段落");
    expect(result).toContain("第一章");
    expect(result).toContain("第二章");
    expect(result).not.toContain("第一章的内容，讲解原理与做法，字数足够长以通过最小长度检测。</p><h2>第一章");
  });

  it("keeps normal articles unchanged", () => {
    const normal = `<p>开篇段落，交代背景与目标。</p>${onePass}<h2>结尾</h2><p>收尾内容。</p>`;
    expect(dedupeWholeArticleContent(normal)).toBe(normal);
  });

  it("keeps short articles unchanged", () => {
    expect(dedupeWholeArticleContent("<p>短内容</p>")).toBe("<p>短内容</p>");
  });
});
