import { describe, expect, it } from "vitest";
import { extractFirstImageSrc } from "./push-draft";

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
