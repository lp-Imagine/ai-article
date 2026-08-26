import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// 默认情况下 getEnvValue 直接读 process.env；
// 用 vi.mock 让它走我们控制的存储，模拟「按用户配置」语义。
const envStore: Record<string, string> = {};
vi.mock("@/lib/config-bridge", () => ({
  getEnvValue: (key: string) => envStore[key],
}));

// 必须放在 mock 之后 import
import { isBlogSyncConfigured, slugFromTitle } from "@/lib/blog-sync";

describe("isBlogSyncConfigured (per-user via config-bridge)", () => {
  beforeEach(() => {
    for (const k of Object.keys(envStore)) delete envStore[k];
  });

  afterEach(() => {
    for (const k of Object.keys(envStore)) delete envStore[k];
  });

  it("returns false when no user-scoped token is set", () => {
    expect(isBlogSyncConfigured()).toBe(false);
  });

  it("returns false when user-scoped token is empty / whitespace", () => {
    envStore["BLOG_GITHUB_TOKEN"] = "   ";
    expect(isBlogSyncConfigured()).toBe(false);
  });

  it("returns true once the current user has a token", () => {
    envStore["BLOG_GITHUB_TOKEN"] = "ghp_user_token";
    expect(isBlogSyncConfigured()).toBe(true);
  });
});

describe("slugFromTitle", () => {
  it("keeps Chinese and strips punctuation like penn-notes renames", () => {
    expect(slugFromTitle("Prompt Cache与上下文管理实践")).toBe(
      "Prompt-Cache与上下文管理实践",
    );
    expect(slugFromTitle("AI Agent幻觉缓解：验证与重试实践")).toBe(
      "AI-Agent幻觉缓解验证与重试实践",
    );
    expect(slugFromTitle("个人知识库+AI，怎么搭才不吃灰")).toBe(
      "个人知识库+AI怎么搭才不吃灰",
    );
    expect(slugFromTitle("模型更快更贵，该怎么选")).toBe(
      "模型更快更贵该怎么选",
    );
    expect(slugFromTitle("长文生成总超时？两报错定位五步提效")).toBe(
      "长文生成总超时两报错定位五步提效",
    );
  });

  it("falls back when title is empty after sanitize", () => {
    expect(slugFromTitle("???", "cmsfallback")).toBe("cmsfallback");
    expect(slugFromTitle("   ")).toBe("untitled");
  });

  it("rejects path separators", () => {
    expect(slugFromTitle("a/b\\c")).toBe("abc");
  });
});
