const WECHAT_API_BASE = "https://api.weixin.qq.com/cgi-bin";
import { getEnvValue } from "@/lib/config-bridge";

type AccessTokenCache = { token: string; expiresAt: number };

/**
 * 每个 AppID 一份 token 缓存：多用户各自配置不同公众号时，
 * 不能共用同一个 token（微信 token 与 appid 绑定，串用会报 invalid credential）。
 */
const tokenCache = new Map<string, AccessTokenCache>();
/** 同一 AppID 的在途 token 请求合并，避免并发推送时重复拉取 */
const inflightTokens = new Map<string, Promise<string>>();

function readSecret(key: string): string | undefined {
  return getEnvValue(key) ?? process.env[key];
}

function isWechatConfigured() {
  return Boolean(readSecret("WECHAT_APP_ID") && readSecret("WECHAT_APP_SECRET"));
}

export async function getAccessToken(): Promise<string> {
  const appId = readSecret("WECHAT_APP_ID");
  const appSecret = readSecret("WECHAT_APP_SECRET");
  if (!appId || !appSecret) {
    throw new Error("WECHAT_APP_ID or WECHAT_APP_SECRET not set");
  }

  const now = Date.now();
  const cached = tokenCache.get(appId);
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  const inflight = inflightTokens.get(appId);
  if (inflight) return inflight;

  const task = (async () => {
    const url = new URL(`${WECHAT_API_BASE}/token`);
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", appId);
    url.searchParams.set("secret", appSecret);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };

    if (!json.access_token) {
      throw new Error(`wechat token error: ${json.errmsg ?? "unknown"}`);
    }

    tokenCache.set(appId, {
      token: json.access_token,
      expiresAt: now + (json.expires_in ?? 7200) * 1000,
    });

    return json.access_token;
  })();

  inflightTokens.set(appId, task);
  try {
    return await task;
  } finally {
    inflightTokens.delete(appId);
  }
}

export async function uploadMedia(
  accessToken: string,
  buffer: Buffer,
  filename: string,
  type: "image" = "image",
): Promise<string> {
  const url = new URL(`${WECHAT_API_BASE}/material/add_material`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("type", type);

  const form = new FormData();
  const bytes = new Uint8Array(buffer);
  form.append("media", new Blob([bytes], { type: "image/jpeg" }), filename);

  const res = await fetch(url.toString(), {
    method: "POST",
    body: form,
  });
  const json = (await res.json()) as {
    media_id?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (!json.media_id) {
    throw new Error(`wechat upload failed: ${json.errmsg ?? "unknown"}`);
  }
  return json.media_id;
}

export function buildWechatDigest(
  summary: string | null | undefined,
  htmlContent: string,
): string {
  const fromSummary = (summary ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (fromSummary) {
    return fromSummary.slice(0, 120);
  }

  const fromContent = htmlContent
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return fromContent.slice(0, 120);
}

export async function createDraft(
  accessToken: string,
  payload: {
    title: string;
    content: string;
    digest?: string;
    thumbMediaId: string;
    author?: string;
  },
): Promise<string> {
  const url = new URL(`${WECHAT_API_BASE}/draft/add`);
  url.searchParams.set("access_token", accessToken);

  const article = {
    title: payload.title,
    content: payload.content,
    digest: payload.digest ?? "",
    thumb_media_id: payload.thumbMediaId,
    author: payload.author ?? "",
  };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articles: [article] }),
  });

  const json = (await res.json()) as {
    media_id?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (!json.media_id) {
    throw new Error(`wechat draft create failed: ${json.errmsg ?? "unknown"}`);
  }
  return json.media_id;
}

export function isReady() {
  return isWechatConfigured();
}

/** 仅用于测试：清空 token 缓存与在途请求。 */
export function _resetWechatTokenCacheForTests() {
  tokenCache.clear();
  inflightTokens.clear();
}
