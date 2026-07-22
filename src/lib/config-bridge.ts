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

const inMemoryEnv: Record<string, string> = {};

let syncedOnce = false;
let syncPromise: Promise<void> | null = null;

export async function syncConfigsToEnv(force = false) {
  if (!force && syncedOnce) return;

  const run = async () => {
    const rows = await db.appConfig.findMany();
    for (const row of rows) {
      const envName = ENV_KEY_MAP[row.configKey];
      if (!envName) continue;
      const value = row.configValue?.trim();
      if (!value) continue; // 跳过空值，避免覆盖 .env.local
      inMemoryEnv[envName] = value;
      process.env[envName] = value;
    }
    syncedOnce = true;
  };

  if (force) {
    await run();
    return;
  }

  if (syncPromise) {
    await syncPromise;
    return;
  }
  syncPromise = run().finally(() => {
    syncPromise = null;
  });
  await syncPromise;
}

export function getEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  return inMemoryEnv[key];
}

export function isSecretKey(envKey: string): envKey is SecretKey {
  return envKey === "AI_API_KEY" || envKey === "AUXILIARY_AI_API_KEY" || envKey === "WECHAT_APP_SECRET";
}