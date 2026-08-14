/**
 * 应用内写作 skill 的公共类型。
 * Skill 只负责策略、结构化结果和纯后处理；模型调用、重试与解析仍由 ai.ts 统一管理。
 */

export type SkillResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  /** 调试用：实际用到的 prompt 版本号 */
  promptVersions?: Record<string, string>;
  /** 调试用：执行耗时（毫秒） */
  durationMs?: number;
};

export interface Skill<I, O> {
  name: string;
  description: string;
  run(input: I): Promise<SkillResult<O>>;
}

export type SkillDefinition = {
  name: string;
  version: string;
  description: string;
};

/**
 * 通用工具：构造 SkillResult
 */
export function ok<T>(data: T, extra?: { promptVersions?: Record<string, string>; durationMs?: number }): SkillResult<T> {
  return { ok: true, data, ...extra };
}

export function fail<T = never>(error: string, extra?: { promptVersions?: Record<string, string>; durationMs?: number }): SkillResult<T> {
  return { ok: false, error, ...extra };
}
