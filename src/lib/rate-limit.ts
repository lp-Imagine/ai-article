/**
 * 进程内滑动窗口速率限制器。
 *
 * 用途：保护登录 / 注册 / 重置密码 / 验证码发送等敏感接口。
 * 多实例部署时各实例独立计数，仍能显著降低被滥用的概率；
 * 若需要严格全局限流，请改用 Redis 或数据库方案。
 *
 * 设计要点：
 * - 每个 key（IP / email 等）维护一个时间戳数组
 * - 每次命中时裁剪掉窗口外的旧记录，判断是否超限
 * - 定期清理记录已全部过期的桶，避免长跑进程内存泄漏
 * - 不依赖外部存储，开箱即用
 */

type Bucket = {
  /** 该 key 当前窗口内的命中时间戳（毫秒） */
  hits: number[];
  /** 最近一次使用的窗口长度；GC 靠它判断桶内记录是否已全部过期 */
  windowMs: number;
};

const BUCKET_GC_INTERVAL_MS = 60_000;

const buckets = new Map<string, Bucket>();
let lastGcAt = 0;

/**
 * 清理已无限流状态的桶。
 *
 * 必须先裁剪窗口外的旧记录再判断是否为空：每次命中都会留下时间戳，
 * 若直接判断 hits 是否为空，桶永远非空、永远删不掉。
 * hits 裁剪后为空说明该 key 已不携带任何计数，删除不会放宽限制。
 */
function gcIfDue(now: number) {
  if (now - lastGcAt < BUCKET_GC_INTERVAL_MS) return;
  lastGcAt = now;
  for (const [key, bucket] of buckets) {
    pruneExpiredHits(bucket, now, bucket.windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

function pruneExpiredHits(bucket: Bucket, now: number, windowMs: number) {
  const cutoff = now - windowMs;
  let expired = 0;
  while (expired < bucket.hits.length && bucket.hits[expired] < cutoff) {
    expired += 1;
  }
  if (expired > 0) bucket.hits.splice(0, expired);
}

export type RateLimitOptions = {
  /** 限流键，建议拼接 "register:ip:1.2.3.4" / "register:email:foo@bar.com" */
  key: string;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大命中次数 */
  max: number;
};

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; remaining: 0; resetAt: number; retryAfterMs: number };

/** 命中一次并判断是否超限。返回结果不含副作用，调用方决定如何处理。 */
export function hitRateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  gcIfDue(now);

  let bucket = buckets.get(opts.key);
  if (!bucket) {
    bucket = { hits: [], windowMs: opts.windowMs };
    buckets.set(opts.key, bucket);
  }
  bucket.windowMs = opts.windowMs;

  pruneExpiredHits(bucket, now, opts.windowMs);

  if (bucket.hits.length >= opts.max) {
    const oldest = bucket.hits[0];
    const resetAt = oldest + opts.windowMs;
    return {
      ok: false,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - now),
    };
  }

  bucket.hits.push(now);
  return {
    ok: true,
    remaining: Math.max(0, opts.max - bucket.hits.length),
    resetAt: now + opts.windowMs,
  };
}

/** 从请求里提取客户端 IP（兼容常见反代头）。无法判断时返回 "unknown"。 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

/** 仅用于测试：清空所有桶。 */
export function _resetRateLimitForTests() {
  buckets.clear();
  lastGcAt = 0;
}

/** 仅用于测试：当前桶数量。 */
export function _rateLimitBucketCountForTests() {
  return buckets.size;
}

/** 仅用于测试：跳过 GC 间隔立即回收。 */
export function _runRateLimitGcForTests() {
  lastGcAt = 0;
  gcIfDue(Date.now());
}
