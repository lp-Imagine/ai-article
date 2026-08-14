import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWechatDigest, getAccessToken, _resetWechatTokenCacheForTests } from "./wechat";

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

describe("getAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetWechatTokenCacheForTests();
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
  });

  function mockTokenFetch() {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const appid = u.searchParams.get("appid") ?? "?";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: `token-for-${appid}`,
          expires_in: 7200,
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function setApp(appId: string, secret: string) {
    process.env.WECHAT_APP_ID = appId;
    process.env.WECHAT_APP_SECRET = secret;
  }

  it("caches the token per appid and reuses it", async () => {
    const fetchMock = mockTokenFetch();
    setApp("appA", "secretA");

    const t1 = await getAccessToken();
    const t2 = await getAccessToken();

    expect(t1).toBe("token-for-appA");
    expect(t2).toBe(t1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a token across different appids", async () => {
    const fetchMock = mockTokenFetch();
    setApp("appA", "secretA");
    const tA = await getAccessToken();

    setApp("appB", "secretB");
    const tB = await getAccessToken();

    expect(tA).toBe("token-for-appA");
    expect(tB).toBe("token-for-appB");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("merges concurrent requests for the same appid", async () => {
    const fetchMock = mockTokenFetch();
    setApp("appA", "secretA");

    const [a, b] = await Promise.all([getAccessToken(), getAccessToken()]);

    expect(a).toBe("token-for-appA");
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
