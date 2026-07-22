export type ArticleBackgroundTask = {
  articleId: string;
  label: string;
  title: string;
  /** 文章标题或主题，用于多任务列表展示 */
  articleLabel?: string;
  startedAt: number;
  statusAtStart: string;
  contentLengthAtStart: number;
};

export type ArticleTaskSnapshot = {
  status: string;
  content?: string | null;
  outline?: unknown;
  updatedAt?: string;
};

export function isOutlineBackgroundTaskLabel(label: string) {
  return label === "生成大纲" || label === "重新生成大纲";
}

export const ARTICLE_BACKGROUND_TASKS_CHANGED = "mp-article-background-tasks-change";

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

/** 取消后台任务：中断进行中的请求并清除浮标状态 */
export function cancelArticleBackgroundTask(articleId: string): ArticleBackgroundTask | null {
  const task = getArticleBackgroundTask(articleId);
  const controller = taskAbortControllers.get(articleId);
  if (controller) {
    controller.abort();
    taskAbortControllers.delete(articleId);
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

function plainTextLengthFromHtml(html: string) {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  }
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\s+/g, "").length;
}

function getInlineImageProgressFromContent(html: string) {
  let maxCurrent = 0;
  let maxTotal = 0;
  for (const match of html.matchAll(/<figure\b[^>]*\sdata-progress="(\d+)\/(\d+)"/gi)) {
    const current = Number(match[1]) || 0;
    const total = Number(match[2]) || 0;
    if (total >= maxTotal) {
      maxTotal = total;
      maxCurrent = current;
    }
  }
  return { current: maxCurrent, total: maxTotal };
}

function isInlineImageGenerationComplete(html: string) {
  const { current, total } = getInlineImageProgressFromContent(html);
  return total > 0 && current >= total;
}

export function isArticleBackgroundTaskComplete(
  task: ArticleBackgroundTask,
  article: ArticleTaskSnapshot,
) {
  if (isOutlineBackgroundTaskLabel(task.label)) {
    const outlines = Array.isArray(article.outline) ? article.outline : [];
    if (outlines.length === 0) return false;
    if (task.statusAtStart === "draft" && article.status !== "draft") return true;
    if (article.updatedAt && new Date(article.updatedAt).getTime() >= task.startedAt + 1500) {
      return true;
    }
    return false;
  }

  if (task.label === "生成章节配图") {
    return isInlineImageGenerationComplete(article.content ?? "");
  }

  const contentLen = plainTextLengthFromHtml(article.content ?? "");
  if (article.status !== task.statusAtStart) return true;
  if (contentLen > task.contentLengthAtStart + 40) return true;
  return false;
}

type ApiResponse<T> = { code: number; data?: T };

const BACKGROUND_TASK_RECOVERY_POLL_MS = 2000;
/** 请求中断后先做一轮快速确认，避免在 catch 里阻塞数分钟 */
const BACKGROUND_TASK_RECOVERY_BURST_MS = 60_000;

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

/** 请求因网关超时等中断后，轮询确认后台任务是否已在服务端完成 */
export async function waitForArticleBackgroundTaskCompletion(
  task: ArticleBackgroundTask,
  options?: {
    signal?: AbortSignal;
    maxWaitMs?: number;
    pollIntervalMs?: number;
  },
): Promise<ArticleTaskSnapshot | null> {
  const maxWaitMs = options?.maxWaitMs ?? getBackgroundTaskRecoveryMaxMs(task);
  const pollIntervalMs = options?.pollIntervalMs ?? BACKGROUND_TASK_RECOVERY_POLL_MS;
  if (maxWaitMs <= 0) return null;

  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    if (options?.signal?.aborted) return null;

    try {
      const res = await fetch(`/api/articles/${task.articleId}?t=${Date.now()}`, {
        cache: "no-store",
        signal: options?.signal,
      });
      const json = (await res.json()) as ApiResponse<ArticleTaskSnapshot>;
      if (json.code === 0 && json.data && isArticleBackgroundTaskComplete(task, json.data)) {
        return json.data;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return null;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining), options?.signal);
  }

  return null;
}

export type BackgroundTaskReconcileOutcome = "completed" | "pending" | "failed";

/**
 * 请求因网关超时等中断后，轮询确认任务是否已在服务端完成。
 * 若轮询窗口内未完成但任务尚未过期，返回 pending，交由浮标/文章页继续跟踪。
 */
export async function reconcileBackgroundTaskAfterRequestFailure(
  task: ArticleBackgroundTask,
  options?: { signal?: AbortSignal; maxWaitMs?: number },
): Promise<BackgroundTaskReconcileOutcome> {
  const remainingTtl = getBackgroundTaskRecoveryMaxMs(task);
  if (remainingTtl <= 0) return "failed";

  const burstWaitMs = Math.min(
    options?.maxWaitMs ?? BACKGROUND_TASK_RECOVERY_BURST_MS,
    remainingTtl,
  );
  const completed = await waitForArticleBackgroundTaskCompletion(task, {
    signal: options?.signal,
    maxWaitMs: burstWaitMs,
  });
  if (completed) return "completed";

  return isArticleBackgroundTaskExpired(task) ? "failed" : "pending";
}

export async function pollArticleBackgroundTasks(options?: {
  onComplete?: (task: ArticleBackgroundTask) => void;
}) {
  const tasks = listArticleBackgroundTasks();
  const now = Date.now();

  await Promise.all(
    tasks.map(async (task) => {
      if (isArticleBackgroundTaskExpired(task, now)) {
        clearArticleBackgroundTask(task.articleId);
        return;
      }

      try {
        const res = await fetch(`/api/articles/${task.articleId}?t=${now}`, { cache: "no-store" });
        const json = (await res.json()) as ApiResponse<ArticleTaskSnapshot>;
        if (json.code !== 0 || !json.data) return;

        if (isArticleBackgroundTaskComplete(task, json.data)) {
          clearArticleBackgroundTask(task.articleId);
          options?.onComplete?.(task);
        }
      } catch {
        // ignore transient poll errors
      }
    }),
  );
}
