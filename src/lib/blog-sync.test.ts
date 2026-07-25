import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// 默认情况下 getEnvValue 直接读 process.env；
// 用 vi.mock 让它走我们控制的存储，模拟「按用户配置」语义。
const envStore: Record<string, string> = {};
vi.mock("@/lib/config-bridge", () => ({
  getEnvValue: (key: string) => envStore[key],
}));

// 必须放在 mock 之后 import
import { isBlogSyncConfigured } from "@/lib/blog-sync";

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
