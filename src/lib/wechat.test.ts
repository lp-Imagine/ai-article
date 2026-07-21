import { describe, expect, it } from "vitest";
import { buildWechatDigest } from "./wechat";

describe("buildWechatDigest", () => {
  it("uses summary when present", () => {
    expect(buildWechatDigest("这是摘要", "<p>正文</p>")).toBe("这是摘要");
  });

  it("falls back to plain text from content when summary is empty", () => {
    expect(
      buildWechatDigest(
        "",
        "<p>上周和一个朋友聊天，他说最近在<strong>搜索参数</strong>上花了很多时间。</p>",
      ),
    ).toBe("上周和一个朋友聊天，他说最近在搜索参数上花了很多时间。");
  });

  it("truncates digest to 120 chars", () => {
    const long = "字".repeat(150);
    expect(buildWechatDigest(long, "<p>正文</p>").length).toBe(120);
  });
});
