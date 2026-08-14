/**
 * 轻量结构化日志：单行 JSON，方便生产环境 grep / 聚合。
 *
 * 用法：
 *   log.info("job started", { jobId, userId, type });
 *   log.warn("retry", { attempt, error: String(err) });
 *   log.error("job failed", { jobId, error: String(err) });
 *
 * - 开发模式下保留前缀 + 人类可读格式，便于本地阅读
 * - 生产模式下输出纯 JSON
 */

type Level = "info" | "warn" | "error";

type Fields = Record<string, unknown>;

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

function emit(level: Level, msg: string, fields?: Fields) {
  const ts = new Date().toISOString();
  const merged: Fields = { ts, level, msg, ...(fields ?? {}) };
  if (isDev()) {
    // 开发模式：键值对格式，避免淹没真实日志
    const tail = fields && Object.keys(fields).length > 0 ? " " + JSON.stringify(fields) : "";
    const line = `[${ts}] ${level.toUpperCase()} ${msg}${tail}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }
  // 生产：纯 JSON 行
  const line = JSON.stringify(merged);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
