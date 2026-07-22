import { AsyncLocalStorage } from "async_hooks";
import { db } from "@/lib/db";

type SecretKey =
  | "AI_API_KEY"
  | "AUXILIARY_AI_API_KEY"
  | "WECHAT_APP_SECRET";

const ENV_KEY_MAP: Record<string, string> = {
  aiApiKey: "AI_API_KEY",
  auxiliaryAiApiKey: "AUXILIARY_AI_API_KEY",
  wechatAppSecret: "WECHAT_APP_SECRET",
  textModelName: "TEXT_MODEL_NAME",
  auxiliaryTextModelName: "AUXILIARY_TEXT_MODEL_NAME",
  imageModelName: "IMAGE_MODEL_NAME",
  aiBaseUrl: "AI_BASE_URL",
  auxiliaryAiBaseUrl: "AUXILIARY_AI_BASE_URL",
  wechatAppId: "WECHAT_APP_ID",
  imageApiKey: "IMAGE_API_KEY",
  imageBaseUrl: "IMAGE_BASE_URL",
  accountPersona: "ACCOUNT_PERSONA",
  defaultStyle: "DEFAULT_STYLE",
};

const configStore = new AsyncLocalStorage<Record<string, string>>();

export async function loadUserConfigMap(userId: string): Promise<Record<string, string>> {
  const rows = await db.appConfig.findMany({ where: { userId } });
  const map: Record<string, string> = {};
  for (const row of rows) {
    const envName = ENV_KEY_MAP[row.configKey];
    if (!envName) continue;
    const value = row.configValue?.trim();
    if (!value) continue;
    map[envName] = value;
  }
  return map;
}

/** 在当前请求上下文中加载并使用该用户的配置（多用户隔离） */
export async function withUserConfig<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const map = await loadUserConfigMap(userId);
  return configStore.run(map, fn);
}

/** @deprecated 配置已改为按用户 AsyncLocalStorage 注入，请使用 withUserConfig */
export async function syncConfigsToEnv() {
  // no-op
}

export function getEnvValue(key: string): string | undefined {
  const store = configStore.getStore();
  if (store?.[key]) return store[key];
  if (process.env[key]) return process.env[key];
  return undefined;
}

export function isSecretKey(envKey: string): envKey is SecretKey {
  return envKey === "AI_API_KEY" || envKey === "AUXILIARY_AI_API_KEY" || envKey === "WECHAT_APP_SECRET";
}

export { ENV_KEY_MAP };
