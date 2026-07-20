const WECHAT_API_BASE = "https://api.weixin.qq.com/cgi-bin";
import { getEnvValue } from "@/lib/config-bridge";

type AccessTokenCache = { token: string; expiresAt: number };

let tokenCache: AccessTokenCache | null = null;

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
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

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

  tokenCache = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 7200) * 1000,
  };

  return json.access_token;
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
