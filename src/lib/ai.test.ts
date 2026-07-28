import { describe, expect, it } from "vitest";
import { splitContentIntoRefineBlocks } from "./ai";

describe("splitContentIntoRefineBlocks", () => {
  it("keeps the whole html as one block when there is no h2", () => {
    const html = "<p>开篇一段</p><p>第二段</p>";
    expect(splitContentIntoRefineBlocks(html)).toEqual([html]);
  });

  it("splits opening and each h2 section", () => {
    const html = [
      "<p>开篇</p>",
      "<hr />",
      "<h2>第一章</h2><p>正文一</p>",
      "<hr />",
      "<h2>第二章</h2><p>正文二</p>",
    ].join("\n");

    const blocks = splitContentIntoRefineBlocks(html);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("开篇");
    expect(blocks[1]).toMatch(/^<h2>第一章<\/h2>/);
    expect(blocks[2]).toMatch(/^<h2>第二章<\/h2>/);
  });

  it("drops no content when re-joined", () => {
    const html = '<p>开篇</p>\n<hr />\n<h2 class="x">一</h2><p>a</p>\n<hr />\n<h2>二</h2><p>b</p>';
    const joined = splitContentIntoRefineBlocks(html).join("\n");
    const strip = (s: string) => s.replace(/\s+/g, "");
    expect(strip(joined)).toBe(strip(html));
  });

  it("ignores a leading h2 without an opening block", () => {
    const html = "<h2>唯一章节</h2><p>内容</p>";
    expect(splitContentIntoRefineBlocks(html)).toEqual([html]);
  });
});
