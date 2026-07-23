export type ArticleBackgroundTask = {
  articleId: string;
  label: string;
  title: string;
  /** 文章标题或主题，用于多任务列表展示 */
  articleLabel?: string;
  startedAt: number;
  statusAtStart: string;
  contentLengthAtStart: number;
  /** 服务端 GenerationJob id；有则优先按 job 轮询 */
  jobId?: string;
};

export type ArticleTaskSnapshot = {
  status: string;
  content?: string | null;
  outline?: unknown;
  updatedAt?: string;
};

export type GenerationJobSnapshot = {
  id: string;
  articleId: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  stepLabel?: string | null;
  error?: string | null;
  label?: string;
};

export function isOutlineBackgroundTaskLabel(label: string) {
  return label === "生成大纲" || label === "重新生成大纲";
}

export const ARTICLE_BACKGROUND_TASKS_CHANGED = "mp-article-background-tasks-change";
export const ARTICLE_BACKGROUND_TASK_FINISHED = "mp-article-background-task-finished";

export type ArticleBackgroundTaskFinishedDetail = {
  articleId: string;
  label: string;
  status: "succeeded" | "failed" | "cancelled";
  error?: string;
};

export function emitArticleBackgroundTaskFinished(detail: ArticleBackgroundTaskFinishedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ArticleBackgroundTaskFinishedDetail>(ARTICLE_BACKGROUND_TASK_FINISHED, {
      detail,
    }),
  );
}

const STORAGE_KEY = "mp-article-background-tasks";
/** 后台任务最长跟踪时间（配图/长文可能持续数分钟） */
const TASK_TTL_MS = 30 * 60 * 1000;

const taskAbortControllers = new Map<string, AbortController>();

function notifyTasksChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ARTICLE_BACKGROUND_TASKS_CHANGED));
}

function readAll(): Record<string, ArticleBackgroundTask> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ArticleBackgroundTask>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(tasks: Record<string, ArticleBackgroundTask>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  notifyTasksChanged();
}

export function startArticleBackgroundTask(task: ArticleBackgroundTask) {
  const tasks = readAll();
  tasks[task.articleId] = task;
  writeAll(tasks);
}

export function patchArticleBackgroundTask(
  articleId: string,
  patch: Partial<ArticleBackgroundTask>,
) {
  const tasks = readAll();
  const current = tasks[articleId];
  if (!current) return;
  tasks[articleId] = { ...current, ...patch };
  writeAll(tasks);
}

export function registerArticleTaskAbortController(articleId: string, controller: AbortController) {
  const existing = taskAbortControllers.get(articleId);
  if (existing && existing !== controller) {
    existing.abort();
  }
  taskAbortControllers.set(articleId, controller);
}

export function unregisterArticleTaskAbortController(articleId: string, controller?: AbortController) {
  const current = taskAbortControllers.get(articleId);
  if (!current) return;
  if (controller && current !== controller) return;
  taskAbortControllers.delete(articleId);
}

/** 取消后台任务：中断轮询并尽量取消服务端 job */
export function cancelArticleBackgroundTask(articleId: string): ArticleBackgroundTask | null {
  const task = getArticleBackgroundTask(articleId);
  const controller = taskAbortControllers.get(articleId);
  if (controller) {
    controller.abort();
    taskAbortControllers.delete(articleId);
  }
  if (task?.jobId) {
    void fetch(`/api/jobs/${task.jobId}/cancel`, { method: "POST" }).catch(() => {});
  }
  clearArticleBackgroundTask(articleId);
  return task;
}

export function clearArticleBackgroundTask(articleId: string) {
  const tasks = readAll();
  if (!tasks[articleId]) return;
  delete tasks[articleId];
  writeAll(tasks);
}

export function getArticleBackgroundTask(articleId: string): ArticleBackgroundTask | null {
  return readAll()[articleId] ?? null;
}

export function listArticleBackgroundTasks(): ArticleBackgroundTask[] {
  return Object.values(readAll()).sort((a, b) => b.startedAt - a.startedAt);
}

export function subscribeArticleBackgroundTasks(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(ARTICLE_BACKGROUND_TASKS_CHANGED, handler);
  return () => window.removeEventListener(ARTICLE_BACKGROUND_TASKS_CHANGED, handler);
}

export function isArticleBackgroundTaskExpired(task: ArticleBackgroundTask, now = Date.now()) {
  return now - task.startedAt > TASK_TTL_MS;
}

type ApiResponse<T> = { code: number; data?: T; message?: string };

const BACKGROUND_TASK_RECOVERY_POLL_MS = 2000;

export function getBackgroundTaskRecoveryMaxMs(task: ArticleBackgroundTask, now = Date.now()) {
  return Math.max(0, TASK_TTL_MS - (now - task.startedAt));
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchGenerationJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<GenerationJobSnapshot | null> {
  const res = await fetch(`/api/jobs/${jobId}?t=${Date.now()}`, {
    cache: "no-store",
    signal,
  });
  const json = (await res.json()) as ApiResponse<GenerationJobSnapshot>;
  if (json.code !== 0 || !json.data) return null;
  return json.data;
}

function isTerminalJobStatus(status: GenerationJobSnapshot["status"]) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** 入队后轮询 job，直到成功/失败/取消 */
export async function waitForGenerationJob(
  jobId: string,
  options?: {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    onProgress?: (job: GenerationJobSnapshot) => void;
    maxWaitMs?: number;
  },
): Promise<GenerationJobSnapshot> {
  const pollIntervalMs = options?.pollIntervalMs ?? BACKGROUND_TASK_RECOVERY_POLL_MS;
  const maxWaitMs = options?.maxWaitMs ?? TASK_TTL_MS;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    if (options?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const job = await fetchGenerationJob(jobId, options?.signal);
    if (job) {
      options?.onProgress?.(job);
      if (isTerminalJobStatus(job.status)) {
        return job;
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining), options?.signal);
  }

  throw new Error("等待任务超时，请稍后刷新查看结果");
}

export type BackgroundTaskReconcileOutcome = "completed" | "pending" | "failed";

/**
 * 请求中断后，若已有 jobId 则继续轮询 job；否则回退到文章快照启发式（兼容旧任务）。
 */
export async function reconcileBackgroundTaskAfterRequestFailure(
  task: ArticleBackgroundTask,
  options?: { signal?: AbortSignal; maxWaitMs?: number },
): Promise<BackgroundTaskReconcileOutcome> {
  const remainingTtl = getBackgroundTaskRecoveryMaxMs(task);
  if (remainingTtl <= 0) return "failed";

  if (task.jobId) {
    try {
      const job = await waitForGenerationJob(task.jobId, {
        signal: options?.signal,
        maxWaitMs: Math.min(options?.maxWaitMs ?? 60_000, remainingTtl),
      });
      if (job.status === "succeeded") return "completed";
      if (job.status === "failed" || job.status === "cancelled") return "failed";
    } catch {
      // fall through
    }
    return isArticleBackgroundTaskExpired(task) ? "failed" : "pending";
  }

  return isArticleBackgroundTaskExpired(task) ? "failed" : "pending";
}

export async function pollArticleBackgroundTasks(options?: {
  onComplete?: (task: ArticleBackgroundTask) => void;
  onFailed?: (task: ArticleBackgroundTask, message: string) => void;
  /** 跳过这些文章（通常是当前正在查看的详情页，由页面自己刷新） */
  ignoreArticleIds?: string[];
}) {
  const ignore = new Set(options?.ignoreArticleIds ?? []);
  const tasks = listArticleBackgroundTasks().filter((task) => !ignore.has(task.articleId));
  const now = Date.now();

  await Promise.all(
    tasks.map(async (task) => {
      if (isArticleBackgroundTaskExpired(task, now)) {
        clearArticleBackgroundTask(task.articleId);
        return;
      }

      if (!task.jobId) return;

      try {
        const job = await fetchGenerationJob(task.jobId);
        if (!job) return;
        if (job.status === "succeeded") {
          clearArticleBackgroundTask(task.articleId);
          emitArticleBackgroundTaskFinished({
            articleId: task.articleId,
            label: task.label,
            status: "succeeded",
          });
          options?.onComplete?.(task);
        } else if (job.status === "failed" || job.status === "cancelled") {
          clearArticleBackgroundTask(task.articleId);
          emitArticleBackgroundTaskFinished({
            articleId: task.articleId,
            label: task.label,
            status: job.status,
            error: job.error || "任务失败",
          });
          options?.onFailed?.(task, job.error || "任务失败");
        }
      } catch {
        // ignore transient poll errors
      }
    }),
  );
}

/** 从服务端同步进行中的任务到 sessionStorage（刷新页面后恢复浮标） */
export async function syncActiveJobsFromServer() {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch("/api/jobs?active=1", { cache: "no-store" });
    const json = (await res.json()) as ApiResponse<
      Array<GenerationJobSnapshot & { createdAt?: string }>
    >;
    if (json.code !== 0 || !json.data) return;

    const previous = readAll();
    const next: Record<string, ArticleBackgroundTask> = {};

    for (const job of json.data) {
      const label = job.label || job.type;
      const existing = previous[job.articleId];
      next[job.articleId] = {
        articleId: job.articleId,
        label,
        title: existing?.title || label,
        articleLabel: existing?.articleLabel,
        startedAt: existing?.startedAt ?? Date.now(),
        statusAtStart: existing?.statusAtStart ?? "draft",
        contentLengthAtStart: existing?.contentLengthAtStart ?? 0,
        jobId: job.id,
      };
    }

    // 保留仍带 jobId、且不在 active 列表中的本地任务，让轮询去确认 succeeded/failed
    // 无 jobId 的脏数据直接丢弃，避免弹窗永远停在「进行中」
    for (const [articleId, task] of Object.entries(previous)) {
      if (next[articleId]) continue;
      if (task.jobId && !isArticleBackgroundTaskExpired(task)) {
        next[articleId] = task;
      }
    }

    writeAll(next);
  } catch {
    // ignore
  }
}
