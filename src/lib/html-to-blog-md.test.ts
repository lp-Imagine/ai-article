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
    expect(md).toContain("<strong>世界</strong>");
    expect(md).not.toContain("**世界**");
  });

  it("converts WeChat span font-weight bold to strong HTML", () => {
    const md = htmlToBlogMarkdown(
      '<p><span style="color:#111111;font-weight:bold;">带走一份压测硬指标清单：</span>平均、P50</p>',
    );
    expect(md).toContain("<strong>带走一份压测硬指标清单：</strong>平均、P50");
    expect(md).not.toContain("**");
  });

  it("converts styled strong tags to HTML emphasis", () => {
    const md = htmlToBlogMarkdown(
      '<p><strong style="color:#111111;font-weight:bold;">GPU/CPU 资源消耗更密集</strong>说明</p>',
    );
    expect(md).toContain("<strong>GPU/CPU 资源消耗更密集</strong>说明");
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

  it("converts HTML tables to GFM markdown for penn-notes", () => {
    const html = `
      <p>下表对比三种选型：</p>
      <table>
        <tr><th>指标</th><th>旧模型（基线）</th><th>新模型 A（快但贵）</th><th>新模型 B（均衡）</th></tr>
        <tr><td>吞吐（req/s）</td><td>120</td><td>200</td><td>160</td></tr>
        <tr><td>P50 延迟（ms）</td><td>180</td><td>120</td><td>150</td></tr>
        <tr><td>典型体验</td><td>偶尔慢</td><td>频繁卡顿</td><td>稳定流畅</td></tr>
      </table>
      <p>模型 B 更均衡。</p>
    `;
    const md = htmlToBlogMarkdown(html);
    expect(md).toContain("| 指标 | 旧模型（基线） | 新模型 A（快但贵） | 新模型 B（均衡） |");
    expect(md).toContain("| --- | --- | --- | --- |");
    expect(md).toContain("| 吞吐（req/s） | 120 | 200 | 160 |");
    expect(md).toContain("| P50 延迟（ms） | 180 | 120 | 150 |");
    expect(md).toContain("下表对比三种选型");
    expect(md).toContain("模型 B 更均衡");
    expect(md).not.toMatch(/吞吐（req\/s）120200160/);
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
