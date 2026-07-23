import type { GenerationJobType, UserRole } from "@prisma/client";

export const JOB_TYPE_LABELS: Record<GenerationJobType, string> = {
  outline: "生成大纲",
  content: "生成正文",
  cover: "生成封面图",
  inline_images: "生成章节配图",
  polish: "全文润色",
  expand: "扩写正文",
};

/** 根据 type + payload 解析对外展示文案（polish + reformat → 整理格式） */
export function jobDisplayLabel(
  type: GenerationJobType,
  payload?: unknown,
): string {
  if (type === "polish" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const mode = (payload as { mode?: unknown }).mode;
    if (mode === "reformat") return "整理格式";
  }
  return JOB_TYPE_LABELS[type];
}

export function labelToJobType(label: string): GenerationJobType | null {
  switch (label) {
    case "生成大纲":
    case "重新生成大纲":
      return "outline";
    case "生成正文":
      return "content";
    case "生成封面图":
      return "cover";
    case "生成章节配图":
      return "inline_images";
    case "全文润色":
      return "polish";
    case "整理格式":
      return "polish";
    case "扩写正文":
      return "expand";
    default:
      return null;
  }
}

export function getMaxConcurrentJobsPerUser(): number {
  const raw = Number(process.env.JOB_MAX_CONCURRENT_PER_USER ?? "2");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}

/** 0 或 JOB_DAILY_LIMIT_ENABLED=0 表示关闭日配额 */
export function getDailyJobLimit(): number | null {
  const enabled = (process.env.JOB_DAILY_LIMIT_ENABLED ?? "1").trim();
  if (enabled === "0" || enabled.toLowerCase() === "false") return null;
  const raw = Number(process.env.JOB_DAILY_LIMIT ?? "50");
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

export function isQuotaExempt(role: UserRole): boolean {
  return role === "SUPER_ADMIN";
}

/** 卡住 running 超过该时间则回收为 failed（毫秒）。默认 20 分钟（需大于最长 LLM 超时） */
export function getStaleRunningJobMs(): number {
  const raw = Number(process.env.JOB_STALE_RUNNING_MS ?? String(20 * 60 * 1000));
  return Number.isFinite(raw) && raw > 0 ? raw : 20 * 60 * 1000;
}
