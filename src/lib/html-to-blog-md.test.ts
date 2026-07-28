import { describe, expect, it } from "vitest";
import {
  collectImageSrcs,
  extractMpCodeBlocks,
  htmlToBlogMarkdown,
} from "@/lib/html-to-blog-md";

describe("htmlToBlogMarkdown", () => {
  it("converts headings and paragraphs", () => {
    const md = htmlToBlogMarkdown("<h2>标题</h2><p>你好 <strong>世界</strong></p>");
    expect(md).toContain("## 标题");
    expect(md).toContain("**世界**");
  });

  it("converts mp-tip to vitepress tip", () => {
    const md = htmlToBlogMarkdown('<div class="mp-tip"><p>注意这点</p></div>');
    expect(md).toContain("::: tip");
    expect(md).toContain("注意这点");
    expect(md).toContain(":::");
  });

  it("rewrites image src", () => {
    const md = htmlToBlogMarkdown(
      '<p><img src="https://cdn.example.com/a.jpg" alt="图"></p>',
      { rewriteSrc: () => "/sync/abc/img-1.jpg" },
    );
    expect(md).toContain("![图](/sync/abc/img-1.jpg)");
  });

  it("preserves figcaption as inline-figure block", () => {
    const md = htmlToBlogMarkdown(
      '<figure><img src="https://cdn.example.com/a.jpg" alt="配图" /><figcaption>第一章 配图</figcaption></figure>',
      { rewriteSrc: () => "/sync/abc/img-1.jpg" },
    );
    expect(md).toContain('<figure class="inline-figure"');
    expect(md).toContain('src="/sync/abc/img-1.jpg"');
    expect(md).toContain("<figcaption>第一章 配图</figcaption>");
  });

  it("drops to plain image when figure has no caption", () => {
    const md = htmlToBlogMarkdown(
      '<figure><img src="https://cdn.example.com/a.jpg" alt="配图" /></figure>',
      { rewriteSrc: () => "/sync/abc/img-1.jpg" },
    );
    expect(md).toContain("![配图](/sync/abc/img-1.jpg)");
    expect(md).not.toContain("<figure");
  });

  it("extracts data-mp-cb code blocks to fenced markdown", () => {
    const source = Buffer.from("let a = 1;\nif (!a) return;", "utf8").toString("base64");
    const html = `<section data-mp-cb="1" data-mp-code-source="${source}" style="x">
<section data-mp-cb-lang="1">JavaScript</section>
<section data-mp-cb-body="1"><span>let a = 1;</span></section>
</section>`;
    const md = htmlToBlogMarkdown(html);
    expect(md).toContain("```javascript");
    expect(md).toContain("let a = 1;");
    expect(md).toContain("if (!a) return;");
  });
});

describe("extractMpCodeBlocks", () => {
  it("keeps surrounding text", () => {
    const source = Buffer.from("x", "utf8").toString("base64");
    const html = `<p>before</p><section data-mp-cb="1" data-mp-code-source="${source}"><section data-mp-cb-lang="1">JS</section><section data-mp-cb-body="1">x</section></section><p>after</p>`;
    const out = extractMpCodeBlocks(html);
    expect(out).toContain("before");
    expect(out).toContain("```");
    expect(out).toContain("after");
  });
});

describe("collectImageSrcs", () => {
  it("dedupes srcs", () => {
    const html =
      '<img src="https://a.com/1.jpg"><img src="https://a.com/1.jpg"><img src="https://a.com/2.png">';
    expect(collectImageSrcs(html)).toEqual([
      "https://a.com/1.jpg",
      "https://a.com/2.png",
    ]);
  });
});
