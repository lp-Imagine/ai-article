"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  FileText,
  Image,
  ListTree,
  RefreshCw,
  Save,
  Send,
  Shield,
} from "lucide-react";
import PreviewDialog from "@/components/preview-dialog";
import PushDialog from "@/components/push-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldLabel } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { ProgressDialog, type ProgressStep } from "@/components/progress-dialog";
import {
  ARTICLE_BACKGROUND_TASKS_CHANGED,
  ARTICLE_BACKGROUND_TASK_FINISHED,
  clearArticleBackgroundTask,
  cancelArticleBackgroundTask,
  emitArticleBackgroundTaskFinished,
  getArticleBackgroundTask,
  isArticleBackgroundTaskExpired,
  isOutlineBackgroundTaskLabel,
  patchArticleBackgroundTask,
  registerArticleTaskAbortController,
  unregisterArticleTaskAbortController,
  startArticleBackgroundTask,
  reconcileBackgroundTaskAfterRequestFailure,
  waitForGenerationJob,
  type ArticleBackgroundTaskFinishedDetail,
} from "@/lib/article-task-tracker";

type PublishRecord = {
  id: number;
  channel: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

type OutlineSection = { heading: string; summary: string };
type OutlineOption = {
  index: number;
  title: string;
  positioning: string;
  sections: OutlineSection[];
};

type ArticleRecord = {
  id: string;
  topic: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  outline: OutlineOption[] | null;
  selectedOutlineIndex: number | null;
  status: string;
  coverImageUrl: string | null;
  wechatDraftId: string | null;
  style: string | null;
  wordCount: number | null;
};

type ApiResponse<T> = { code: number; message: string; data: T };

const statusLabel: Record<string, string> = {
  draft: "草稿",
  outlined: "已选大纲",
  generated: "已生成正文",
  edited: "已修改",
  checked: "已检测",
  pushed: "已推送",
  failed: "推送失败",
};

const statusVariant: Record<string, string> = {
  draft: "badge-muted",
  outlined: "badge-accent",
  generated: "badge-warning",
  edited: "badge-accent",
  checked: "badge-success",
  pushed: "badge-success",
  failed: "badge-danger",
};

const LONG_RUNNING_ACTIONS: Record<string, { title: string; estimatedSeconds: number }> = {
  "生成大纲": { title: "正在生成大纲方案", estimatedSeconds: 45 },
  "重新生成大纲": { title: "正在重新生成大纲", estimatedSeconds: 45 },
  "生成正文": { title: "正在生成正文与封面图", estimatedSeconds: 180 },
  "生成章节配图": { title: "正在为各章节生成配图", estimatedSeconds: 300 },
  "生成封面图": { title: "正在生成封面图（替换）", estimatedSeconds: 30 },
  "全文润色": { title: "正在润色全文", estimatedSeconds: 20 },
  "扩写正文": { title: "正在扩写正文", estimatedSeconds: 15 },
};

export default function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [article, setArticle] = useState<ArticleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [pushResult, setPushResult] = useState<{ draftId: string; status: string } | null>(null);
  const [pushRecords, setPushRecords] = useState<PublishRecord[]>([]);
  const [editorTab, setEditorTab] = useState<"meta" | "content">("meta");
  const [activeOutlineView, setActiveOutlineView] = useState(0);
  const [outlinePanelOpen, setOutlinePanelOpen] = useState(true);
  const [mobileStage, setMobileStage] = useState<"outline" | "content" | "publish">("outline");
  const [expandedOutlineSection, setExpandedOutlineSection] = useState<number | null>(null);
  const mobileStageReadyRef = useRef(false);
  const [titleCandidates, setTitleCandidates] = useState<Array<{ text: string; style: string }>>([]);
  const [progress, setProgress] = useState<{
    open: boolean;
    title: string;
    steps: ProgressStep[];
    generatedCount?: number;
    totalCount?: number;
    error?: string | null;
    startedAt?: number | null;
  }>({ open: false, title: "", steps: [], startedAt: null });
  const [progressKey, setProgressKey] = useState(0);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const toast = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const actionToastIdRef = useRef<string | null>(null);
  const progressCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const inlineImagesPollRef = useRef<{
    sessionId: number;
    baselineFigureCount: number;
    figuresCleared: boolean;
  }>({ sessionId: 0, baselineFigureCount: 0, figuresCleared: true });

  const resetProgressState = useCallback(() => ({
    open: false,
    title: "",
    steps: [] as ProgressStep[],
    generatedCount: 0,
    totalCount: 1,
    error: null,
    startedAt: null as number | null,
  }), []);

  const clearProgressCloseTimer = useCallback(() => {
    if (progressCloseTimerRef.current) {
      clearTimeout(progressCloseTimerRef.current);
      progressCloseTimerRef.current = null;
    }
  }, []);

  const scheduleProgressClose = useCallback((sessionId: number, delay = 800) => {
    clearProgressCloseTimer();
    progressCloseTimerRef.current = setTimeout(() => {
      if (inlineImagesPollRef.current.sessionId === sessionId) {
        setProgress(resetProgressState());
      }
      progressCloseTimerRef.current = null;
    }, delay);
  }, [clearProgressCloseTimer, resetProgressState]);

  const plainCharCount = useMemo(() => {
    const html = article?.content ?? "";
    if (typeof document === "undefined") {
      return html.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    }
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || "").replace(/\s+/g, "").length;
  }, [article?.content]);

  const targetProgress = article?.wordCount
    ? Math.min(1, plainCharCount / article.wordCount)
    : 1;

  const refresh = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/articles/${id}?t=${Date.now()}`, { cache: "no-store" });
    const json = (await res.json()) as ApiResponse<ArticleRecord>;
    if (json.code === 0 && json.data) {
      setArticle(json.data);
      if (json.data.selectedOutlineIndex != null) {
        setActiveOutlineView(json.data.selectedOutlineIndex);
      }
    } else {
      toast.show({ message: json.message || "文章不存在", variant: "error" });
    }
    setLoading(false);
  }, [id, toast]);

  // 首页/其它页清掉任务时，详情页必须主动拉最新文章，否则弹窗关了内容还是旧的
  useEffect(() => {
    if (!id) return;

    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<ArticleBackgroundTaskFinishedDetail>).detail;
      if (!detail || detail.articleId !== id) return;
      if (abortRef.current) return; // callAction 自己会 refresh

      void (async () => {
        await refresh();
        if (!mountedRef.current) return;
        setBusy(null);
        if (detail.status === "succeeded") {
          setProgress((p) =>
            p.open
              ? {
                  ...p,
                  error: null,
                  generatedCount: p.totalCount ?? 1,
                  steps: p.steps.map((s) => ({ ...s, status: "done" as const })),
                }
              : p,
          );
          window.setTimeout(() => {
            if (mountedRef.current) setProgress(resetProgressState());
          }, 800);
        } else {
          setProgress(resetProgressState());
        }
      })();
    };

    window.addEventListener(ARTICLE_BACKGROUND_TASK_FINISHED, onFinished);
    return () => window.removeEventListener(ARTICLE_BACKGROUND_TASK_FINISHED, onFinished);
  }, [id, refresh, resetProgressState]);

  async function fetchPushHistory() {
    try {
      const res = await fetch(`/api/articles/${id}/push-history`, { cache: "no-store" });
      const json = await res.json() as ApiResponse<PublishRecord[]>;
      if (json.code === 0 && json.data) {
        setPushRecords(json.data);
      }
    } catch {
      // ignore
    }
  }

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      if (!id) return;
      const res = await fetch(`/api/articles/${id}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<ArticleRecord>;
      if (json.code === 0 && json.data) {
        setArticle(json.data);
        if (json.data.selectedOutlineIndex != null) {
          setActiveOutlineView(json.data.selectedOutlineIndex);
        }
      } else {
        toast.show({ message: json.message || "文章不存在", variant: "error" });
      }
      setLoading(false);
    })();
    fetchPushHistory();
  }, [id, toast]);

  useEffect(() => {
    if (article?.selectedOutlineIndex != null) {
      setActiveOutlineView(article.selectedOutlineIndex);
    }
  }, [article?.selectedOutlineIndex]);

  // 移动端按文章进度进入对应 Tab；有正文时大纲默认收起（仅初始化一次）
  useEffect(() => {
    if (!article || mobileStageReadyRef.current) return;
    mobileStageReadyRef.current = true;
    const hasContent = Boolean(article.content?.trim());
    const hasOutline = Array.isArray(article.outline) && article.outline.length > 0;
    if (hasContent) {
      setMobileStage("content");
      setOutlinePanelOpen(false);
    } else if (hasOutline) {
      setMobileStage("outline");
      setOutlinePanelOpen(true);
    } else {
      setMobileStage("outline");
      setOutlinePanelOpen(true);
    }
  }, [article]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!id || loading) return;
    // 当前页已有 callAction 在轮询时，避免双重恢复逻辑抢状态
    if (abortRef.current) return;

    let stopped = false;
    let uiShown = false;
    let finishing = false;

    const closeResumeUi = () => {
      if (!mountedRef.current) return;
      setBusy(null);
      setProgress(resetProgressState());
    };

    const resumeProgressUi = (task: NonNullable<ReturnType<typeof getArticleBackgroundTask>>) => {
      if (!mountedRef.current) return;
      if (!uiShown) {
        uiShown = true;
        setProgressKey((key) => key + 1);
        setProgress({
          open: true,
          title: task.title,
          steps: [
            { label: "准备工作", status: "done" },
            {
              label: isOutlineBackgroundTaskLabel(task.label)
                ? "正在生成大纲方案"
                : task.label === "生成章节配图"
                  ? "正在生成配图"
                  : "调用 AI 生成中",
              status: "running",
            },
            { label: "保存到草稿", status: "pending" },
          ],
          generatedCount: 0,
          totalCount: 1,
          error: null,
          startedAt: task.startedAt,
        });
      }
      setBusy((current) => current ?? task.label);
    };

    const finishSucceeded = async (label: string) => {
      if (finishing) return;
      finishing = true;
      clearArticleBackgroundTask(id);
      try {
        await refresh();
      } catch {
        // ignore refresh errors; still close UI
      }
      if (!mountedRef.current) return;
      setProgress((p) => ({
        ...p,
        open: true,
        generatedCount: p.totalCount ?? 1,
        error: null,
        steps: (p.steps.length
          ? p.steps
          : [
              { label: "准备工作", status: "done" as const },
              { label: label, status: "done" as const },
              { label: "保存到草稿", status: "done" as const },
            ]
        ).map((s) => ({ ...s, status: "done" as const })),
      }));
      setBusy(null);
      toast.show({
        title: "后台任务已完成",
        message: `${label}已完成`,
        variant: "success",
      });
      window.setTimeout(() => {
        if (mountedRef.current) setProgress(resetProgressState());
      }, 800);
    };

    const finishFailed = (label: string, message: string) => {
      if (finishing) return;
      finishing = true;
      clearArticleBackgroundTask(id);
      if (!mountedRef.current) return;
      setBusy(null);
      setProgress((p) => ({
        ...p,
        open: true,
        error: message,
        steps: p.steps.map((s) =>
          s.status === "running" ? { ...s, status: "error" as const } : s,
        ),
      }));
      toast.show({
        title: "后台任务失败",
        message,
        variant: "error",
      });
      window.setTimeout(() => {
        if (mountedRef.current) setProgress(resetProgressState());
      }, 2000);
    };

    const poll = async () => {
      if (stopped || finishing || abortRef.current) return;

      const task = getArticleBackgroundTask(id);
      if (!task) {
        // 首页等外部已清掉任务：关掉弹窗并补一次刷新（finished 事件可能早于监听）
        if (uiShown && !finishing) {
          finishing = true;
          try {
            await refresh();
          } catch {
            // ignore
          }
          closeResumeUi();
        }
        return;
      }

      if (isArticleBackgroundTaskExpired(task)) {
        clearArticleBackgroundTask(id);
        closeResumeUi();
        return;
      }

      try {
        if (!task.jobId) {
          // jobId 可能稍后由首页 patch 进来，先展示进度并继续等
          resumeProgressUi(task);
          return;
        }

        const { fetchGenerationJob } = await import("@/lib/article-task-tracker");
        const job = await fetchGenerationJob(task.jobId);
        if (stopped || finishing || abortRef.current) return;
        if (!job) return;

        if (job.status === "succeeded") {
          await finishSucceeded(task.label);
          return;
        }

        if (job.status === "failed" || job.status === "cancelled") {
          finishFailed(task.label, job.error || `${task.label}失败`);
          return;
        }

        resumeProgressUi(task);
        if (!mountedRef.current) return;
        setProgress((p) => ({
          ...p,
          open: true,
          startedAt: p.startedAt ?? task.startedAt,
          generatedCount:
            typeof job.progress === "number"
              ? Math.round((job.progress / 100) * Math.max(1, p.totalCount ?? 1))
              : p.generatedCount,
          steps: p.steps.map((s, i) =>
            i === 1
              ? { ...s, status: "running", label: job.stepLabel || s.label }
              : i === 2 && job.progress >= 85
                ? { ...s, status: "running" }
                : s,
          ),
        }));
      } catch {
        // ignore transient poll errors
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 2000);

    const onTasksChanged = () => {
      void poll();
    };
    window.addEventListener(ARTICLE_BACKGROUND_TASKS_CHANGED, onTasksChanged);

    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener(ARTICLE_BACKGROUND_TASKS_CHANGED, onTasksChanged);
    };
  }, [id, loading, toast, resetProgressState, refresh]);

  function cancelCurrent() {
    cancelArticleBackgroundTask(id);
    abortRef.current = null;
    inlineImagesPollRef.current.sessionId += 1;
    clearProgressCloseTimer();
    if (actionToastIdRef.current) {
      toast.dismiss(actionToastIdRef.current);
      actionToastIdRef.current = null;
    }
    setBusy(null);
    setProgress(resetProgressState());
    setCancelConfirmOpen(false);
    toast.show({ message: "已取消当前操作", variant: "info" });
  }

  function requestCancelCurrent() {
    setCancelConfirmOpen(true);
  }

  function applyInlineImagePollProgress(content: string, sessionId: number) {
    if (inlineImagesPollRef.current.sessionId !== sessionId) return;

    const pollState = inlineImagesPollRef.current;
    const figureCount = countFiguresInHtml(content);

    if (!pollState.figuresCleared && figureCount < pollState.baselineFigureCount) {
      pollState.figuresCleared = true;
    }

    const generatedCount = pollState.figuresCleared
      ? getInlineImageProgressFromContent(content)
      : 0;

    setProgress((p) => {
      if (inlineImagesPollRef.current.sessionId !== sessionId) return p;
      const total = p.totalCount || 1;
      const nextCount = Math.min(generatedCount, total);
      const displayIndex = Math.max(nextCount, 1);
      return {
        ...p,
        generatedCount: nextCount,
        steps: p.steps.map((s, i) =>
          i === 0
            ? { ...s, status: "done" }
            : i === 1
              ? {
                  ...s,
                  status: nextCount >= total && total > 0 ? "done" : "running",
                  label:
                    nextCount >= total
                      ? "配图生成完成"
                      : nextCount > 0
                        ? `正在生成第 ${displayIndex} 张配图`
                        : "正在生成第 1 张配图",
                }
              : s,
        ),
      };
    });
  }

  async function handleGenerateTitles() {
    if (busy) {
      toast.show({ message: `请先等待「${busy}」完成`, variant: "warning" });
      return;
    }
    setBusy("生成备选标题");
    const toastId = toast.show({ message: "生成备选标题中...", variant: "info", duration: 0 });
    try {
      const res = await fetch(`/api/articles/${id}/generate-titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as ApiResponse<{ titles: Array<{ text: string; style: string }> }>;
      if (json.code !== 0 || !json.data?.titles?.length) {
        throw new Error(json.message || "生成备选标题失败");
      }
      setTitleCandidates(json.data.titles);
      setEditorTab("meta");
      toast.dismiss(toastId);
      toast.show({
        title: "备选标题已生成",
        message: "点击下方标题即可替换，记得保存草稿",
        variant: "success",
      });
    } catch (err) {
      toast.dismiss(toastId);
      const message = err instanceof Error ? err.message : "生成备选标题失败";
      toast.show({ title: "操作失败", message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerateSummary() {
    if (busy) {
      toast.show({ message: `请先等待「${busy}」完成`, variant: "warning" });
      return;
    }
    setBusy("生成摘要");
    const toastId = toast.show({ message: "生成摘要中...", variant: "info", duration: 0 });
    try {
      const res = await fetch(`/api/articles/${id}/generate-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as ApiResponse<ArticleRecord & { source?: "content" | "topic" }>;
      if (json.code !== 0) {
        throw new Error(json.message || "生成摘要失败");
      }
      await refresh();
      setEditorTab("meta");
      toast.dismiss(toastId);
      toast.show({
        title: "摘要已更新",
        message:
          json.data?.source === "content"
            ? "已根据正文提炼摘要"
            : "正文较短，已根据主题生成摘要",
        variant: "success",
      });
    } catch (err) {
      toast.dismiss(toastId);
      const message = err instanceof Error ? err.message : "生成摘要失败";
      toast.show({ title: "操作失败", message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  function applyTitleCandidate(text: string) {
    if (!article) return;

    setArticle({ ...article, title: text });
    setEditorTab("meta");

    const outlines = Array.isArray(article.outline) ? article.outline : [];
    const selectedOutline =
      typeof article.selectedOutlineIndex === "number"
        ? outlines.find((o) => o.index === article.selectedOutlineIndex)
        : undefined;
    const outlineTitle = selectedOutline?.title;
    const hasContent = Boolean(article.content?.trim());
    const diverges = outlineTitle ? isTitleDivergedFromOutline(text, outlineTitle) : false;

    if (diverges) {
      toast.show({
        title: "标题已应用",
        message: hasContent
          ? "新标题与当前大纲方案差异较大，请确认与正文内容是否一致。"
          : "新标题与当前大纲方案差异较大，建议重新生成大纲或切换方案后再生成正文。",
        variant: "warning",
        duration: 8000,
        action: hasContent
          ? undefined
          : {
              label: "重新生成大纲",
              onClick: () => {
                void callAction(`/api/articles/${id}/generate-outline`, "重新生成大纲");
              },
            },
      });
      return;
    }

    toast.show({ message: "已应用标题，记得保存草稿", variant: "success" });
  }

  async function callAction(path: string, label: string) {
    if (busy) {
      toast.show({ message: `请先等待「${busy}」完成`, variant: "warning" });
      return;
    }

    setBusy(label);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const isLong = label in LONG_RUNNING_ACTIONS;
    const longCfg = LONG_RUNNING_ACTIONS[label];
    const isInlineImages = label === "生成章节配图";
    const isOutline = isOutlineBackgroundTaskLabel(label);

    if (isLong) {
      const totalSections = isInlineImages
        ? (article?.content?.match(/<h2[^>]*>/g)?.length ?? 0) - 1
        : 1;
      const startedAt = Date.now();
      setProgressKey((key) => key + 1);
      setProgress({
        open: true,
        title: longCfg.title,
        steps: [
          { label: "准备工作", status: "running" },
          isInlineImages
            ? { label: "正在生成第 1 张配图", status: "pending" }
            : isOutline
              ? { label: "正在生成大纲方案", status: "pending" }
              : { label: "调用 AI 生成中", status: "pending" },
          { label: "保存到草稿", status: "pending" },
        ],
        generatedCount: 0,
        totalCount: Math.max(1, totalSections),
        error: null,
        startedAt,
      });

      startArticleBackgroundTask({
        articleId: id,
        label,
        title: longCfg.title,
        articleLabel: article?.title ?? article?.topic ?? "未命名文章",
        startedAt,
        statusAtStart: article?.status ?? "draft",
        contentLengthAtStart: plainTextLengthFromHtml(article?.content ?? ""),
      });
      registerArticleTaskAbortController(id, ctrl);
    }

    let inlineImagesSessionId = 0;
    let pollingTimer: ReturnType<typeof setInterval> | undefined;
    let progressSessionId = inlineImagesPollRef.current.sessionId;

    if (isLong) {
      clearProgressCloseTimer();
      progressSessionId = inlineImagesPollRef.current.sessionId + 1;
      inlineImagesPollRef.current.sessionId = progressSessionId;
    }

    if (isInlineImages) {
      inlineImagesSessionId = progressSessionId;

      let baselineFigureCount = 0;
      try {
        const freshRes = await fetch(`/api/articles/${id}?t=${Date.now()}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const freshJson = (await freshRes.json()) as ApiResponse<ArticleRecord>;
        if (freshJson.code === 0 && freshJson.data) {
          setArticle(freshJson.data);
          baselineFigureCount = countFiguresInHtml(freshJson.data.content ?? "");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
      }

      if (inlineImagesPollRef.current.sessionId !== inlineImagesSessionId) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      inlineImagesPollRef.current = {
        sessionId: inlineImagesSessionId,
        baselineFigureCount,
        figuresCleared: baselineFigureCount === 0,
      };

      pollingTimer = setInterval(async () => {
        if (inlineImagesPollRef.current.sessionId !== inlineImagesSessionId) return;
        try {
          const pollRes = await fetch(`/api/articles/${id}?t=${Date.now()}`, {
            cache: "no-store",
            signal: ctrl.signal,
          });
          const pollJson = (await pollRes.json()) as ApiResponse<ArticleRecord>;
          if (pollJson.code !== 0 || !pollJson.data?.content) return;
          applyInlineImagePollProgress(pollJson.data.content, inlineImagesSessionId);
        } catch {
          // ignore aborted / transient poll errors
        }
      }, 2000);
    }

    const toastId = isLong
      ? null
      : toast.show({
          message: `${label}中...`,
          variant: "info",
          duration: 0,
        });
    actionToastIdRef.current = toastId;

    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: ctrl.signal,
      });

      const json = (await res.json()) as ApiResponse<{
        jobId?: string;
        status?: string;
        content?: string;
        images?: Array<{ heading: string; url: string }>;
        total?: number;
      }>;

      if (json.code !== 0) {
        throw new Error(json.message || `${label} 失败`);
      }

      const jobId = json.data?.jobId;
      if (isLong && jobId) {
        patchArticleBackgroundTask(id, { jobId });

        if (isLong) {
          setProgress((p) => ({
            ...p,
            steps: p.steps.map((s, i) =>
              i === 0 ? { ...s, status: "done" } : i === 1 ? { ...s, status: "running" } : s,
            ),
          }));
        }

        const job = await waitForGenerationJob(jobId, {
          signal: ctrl.signal,
          onProgress: (snap) => {
            if (!mountedRef.current) return;
            const terminal =
              snap.status === "succeeded" ||
              snap.status === "failed" ||
              snap.status === "cancelled";
            setProgress((p) => ({
              ...p,
              generatedCount:
                typeof snap.progress === "number"
                  ? Math.round((snap.progress / 100) * Math.max(1, p.totalCount ?? 1))
                  : p.generatedCount,
              steps: p.steps.map((s, i) => {
                if (terminal) {
                  if (snap.status === "succeeded") {
                    return { ...s, status: "done" as const };
                  }
                  if (i === 1 || s.status === "running") {
                    return { ...s, status: "error" as const };
                  }
                  return s;
                }
                if (i === 1) {
                  return {
                    ...s,
                    status: "running" as const,
                    label: snap.stepLabel || s.label,
                  };
                }
                if (i === 2 && snap.progress >= 85) {
                  return { ...s, status: "running" as const };
                }
                return s;
              }),
            }));

            if (isInlineImages) {
              void fetch(`/api/articles/${id}?t=${Date.now()}`, { cache: "no-store" })
                .then((r) => r.json())
                .then((pollJson: ApiResponse<ArticleRecord>) => {
                  if (pollJson.code === 0 && pollJson.data?.content) {
                    applyInlineImagePollProgress(pollJson.data.content, inlineImagesSessionId);
                  }
                })
                .catch(() => {});
            }
          },
        });

        if (pollingTimer) {
          clearInterval(pollingTimer);
          pollingTimer = undefined;
        }

        if (job.status === "failed" || job.status === "cancelled") {
          throw new Error(job.error || `${label}失败`);
        }

        clearArticleBackgroundTask(id);
        emitArticleBackgroundTaskFinished({
          articleId: id,
          label,
          status: "succeeded",
        });
        await refresh();

        if (!mountedRef.current) return;
        setProgress((p) => ({
          ...p,
          generatedCount: p.totalCount,
          steps: p.steps.map((s) => ({ ...s, status: "done" as const })),
        }));

        if (toastId) toast.dismiss(toastId);
        actionToastIdRef.current = null;
        toast.show({ title: "操作成功", message: `${label}完成`, variant: "success" });
        scheduleProgressClose(progressSessionId, 800);
        return;
      }

      // 非异步任务（标题/摘要等）仍走同步响应
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = undefined;
      }

      if (isLong) {
        setProgress((p) => ({
          ...p,
          steps: p.steps.map((s, i) =>
            i === 0
              ? { ...s, status: "done" }
              : i === 1
                ? { ...s, status: "done", label: isInlineImages ? `已生成配图` : `${label}完成` }
                : i === 2
                  ? { ...s, status: "running" }
                  : s,
          ),
        }));
      }

      await refresh();

      if (isLong) {
        clearArticleBackgroundTask(id);
        if (!mountedRef.current) return;
        setProgress((p) => ({
          ...p,
          generatedCount: isInlineImages
            ? (json.data?.total ?? json.data?.images?.length ?? p.totalCount)
            : p.totalCount,
          steps: p.steps.map((s, i) => (i === 2 ? { ...s, status: "done" } : s)),
        }));
      }

      if (toastId) toast.dismiss(toastId);
      actionToastIdRef.current = null;
      toast.show({ title: "操作成功", message: `${label}完成`, variant: "success" });

      if (isLong) {
        scheduleProgressClose(progressSessionId, 800);
      }
    } catch (err) {
      if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = undefined; }
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (toastId) toast.dismiss(toastId);
      actionToastIdRef.current = null;

      if (isAbort) {
        clearArticleBackgroundTask(id);
        if (isLong) {
          if (!mountedRef.current) return;
          setProgress((p) => ({
            ...p,
            error: "用户已取消",
            generatedCount: 0,
            steps: p.steps.map((s) =>
              s.status === "running" ? { ...s, status: "error" } : s,
            ),
          }));
          scheduleProgressClose(progressSessionId, 1200);
        }
      } else {
        const task = isLong ? getArticleBackgroundTask(id) : null;
        if (task) {
          const outcome = await reconcileBackgroundTaskAfterRequestFailure(task);
          if (outcome === "completed") {
            clearArticleBackgroundTask(id);
            if (!mountedRef.current) return;
            await refresh();
            if (toastId) toast.dismiss(toastId);
            actionToastIdRef.current = null;
            toast.show({ title: "操作成功", message: `${label}完成`, variant: "success" });
            if (isLong) {
              setProgress((p) => ({
                ...p,
                generatedCount: isInlineImages ? p.totalCount : p.totalCount,
                steps: p.steps.map((s, i) =>
                  i >= 1 ? { ...s, status: "done" as const } : s,
                ),
              }));
              scheduleProgressClose(progressSessionId, 800);
            }
            return;
          }
          if (outcome === "pending") {
            if (!mountedRef.current) return;
            toast.show({
              title: `${label}仍在进行`,
              message: "连接已中断，服务端可能仍在处理。请保持页面打开，完成后会自动刷新。",
              variant: "info",
              duration: 8000,
            });
            return;
          }
        }

        clearArticleBackgroundTask(id);
        const message = err instanceof Error ? err.message : `${label} 失败`;
        if (!mountedRef.current) return;
        toast.show({ title: "操作失败", message, variant: "error", duration: 8000 });
        if (isLong) {
          setProgress((p) => ({
            ...p,
            error: message,
            steps: p.steps.map((s) =>
              s.status === "running" ? { ...s, status: "error" } : s,
            ),
          }));
          scheduleProgressClose(progressSessionId, 3000);
        }
      }
    } finally {
      if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = undefined; }
      if (isLong) {
        unregisterArticleTaskAbortController(id, ctrl);
      }
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function handlePushConfirm() {
    setPushDialogOpen(false);
    if (article) {
      await saveArticle({ silent: true });
    }
    await callAction(`/api/articles/${id}/push-draft`, "推送公众号草稿箱");
    const res = await fetch(`/api/articles/${id}`, { cache: "no-store" });
    const json = (await res.json()) as ApiResponse<ArticleRecord>;
    if (json.code === 0 && json.data) {
      setPushResult({
        draftId: json.data.wechatDraftId ?? "",
        status: json.data.status,
      });
    }
    fetchPushHistory();
  }

  async function selectOutline(outlineIndex: number) {
    if (busy) return;
    setBusy("选择大纲");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`/api/articles/${id}/select-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outlineIndex }),
        signal: ctrl.signal,
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (json.code !== 0) throw new Error(json.message || "选择大纲失败");
      toast.show({ message: "已选择该大纲", variant: "success" });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "选择大纲失败";
      toast.show({ message, variant: "error" });
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function saveArticle(options?: { silent?: boolean }) {
    if (!article) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: article.title,
          summary: article.summary,
          content: article.content,
          coverImageUrl: article.coverImageUrl,
          status: "edited",
        }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (json.code !== 0) throw new Error(json.message || "保存失败");
      if (!options?.silent) {
        toast.show({ message: "草稿已保存", variant: "success" });
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      toast.show({ message, variant: "error" });
      if (options?.silent) throw err;
    } finally {
      setSaving(false);
    }
  }

  async function copyTitle(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: `已复制：${text}`, variant: "success" });
    } catch {
      toast.show({ message: "浏览器不支持剪贴板复制", variant: "error" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 text-sm text-[var(--muted)]">
        <span className="loading-dot" />
        加载中...
      </div>
    );
  }

  if (!article) {
    return (
      <div className="empty-state">
        <p className="text-lg text-[var(--danger)]">文章不存在或已被删除</p>
        <Link href="/" className="mt-4 inline-flex items-center gap-2 btn-secondary text-sm">
          <ArrowLeft size={14} />
          返回工作台
        </Link>
      </div>
    );
  }

  const outlines = Array.isArray(article.outline) ? article.outline : [];
  const hasSelectedOutline = typeof article.selectedOutlineIndex === "number";
  const statusClass = statusVariant[article.status] ?? "badge-muted";
  const viewingOutline = outlines.find((o) => o.index === activeOutlineView) ?? outlines[0];
  const viewingSelected = viewingOutline?.index === article.selectedOutlineIndex;

  return (
    <>
      <div className="article-topbar">
        <Link href="/" className="article-back">
          <ArrowLeft size={14} />
          返回工作台
        </Link>
        <div className="article-topbar-row">
          <div className="article-topbar-main">
            <h1 className="article-topbar-title">{article.title ?? article.topic}</h1>
            <div className="article-topbar-meta">
              {article.title && article.topic !== article.title ? (
                <span className="article-topbar-meta-item" title={article.topic}>
                  {article.topic}
                </span>
              ) : null}
              {article.style ? (
                <span className="article-topbar-meta-item">{article.style}</span>
              ) : null}
              {article.wordCount ? (
                <span className="article-topbar-meta-item">目标 {article.wordCount} 字</span>
              ) : null}
              <span className={`badge ${statusClass}`}>
                {statusLabel[article.status] ?? article.status}
              </span>
            </div>
          </div>
          <div className="article-topbar-right">
            {article.wordCount ? (
              <div className="word-stat" title="正文字数">
                <span className="word-stat-value">
                  {plainCharCount}
                  <span className="word-stat-sep">/</span>
                  {article.wordCount}
                </span>
                <div className="progress-bar word-stat-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.round(targetProgress * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}
            <div className="article-topbar-actions">
            <button onClick={() => void saveArticle()} disabled={saving} className="btn-secondary text-sm">
              {saving ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  保存中...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Save size={14} />
                  保存草稿
                </span>
              )}
            </button>
            <div className="article-topbar-publish">
              <button
                onClick={() => setPreviewOpen(true)}
                disabled={!article.content}
                className="btn-secondary text-sm article-topbar-publish-btn"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Eye size={14} />
                  预览
                </span>
              </button>
              <button
                type="button"
                onClick={() => callAction(`/api/articles/${id}/generate-content`, "生成正文")}
                disabled={busy !== null || !hasSelectedOutline}
                title={hasSelectedOutline ? undefined : "请先在下方大纲区点击「选择这个大纲」"}
                className="btn-secondary text-sm article-topbar-publish-btn"
              >
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={14} />
                  {busy === "生成正文" ? "生成中..." : "生成正文"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPushResult(null);
                  setPushDialogOpen(true);
                }}
                disabled={busy !== null || !article.content}
                className="btn-primary text-sm article-topbar-publish-btn article-topbar-publish-btn-primary"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Send size={14} />
                  推送草稿箱
                </span>
              </button>
            </div>
          </div>
          </div>
        </div>
        {article.wechatDraftId ? (
          <p className="article-topbar-draft-id">微信草稿 ID：{article.wechatDraftId}</p>
        ) : null}

        <nav className="mobile-stage-tabs" aria-label="编辑步骤">
          {(
            [
              { id: "outline" as const, label: "大纲", icon: ListTree },
              { id: "content" as const, label: "正文", icon: FileText },
              { id: "publish" as const, label: "发布", icon: Send },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`mobile-stage-tab ${mobileStage === id ? "mobile-stage-tab-active" : ""}`}
              onClick={() => setMobileStage(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="editor-stack">
        <div
          className={`mobile-stage-panel ${mobileStage === "outline" ? "mobile-stage-panel-active" : ""}`}
          data-stage="outline"
        >
        {outlines.length > 0 && (
          <section className="outline-panel stage-order-outline">
            <button
              type="button"
              className="outline-panel-head outline-panel-head-toggle"
              onClick={() => setOutlinePanelOpen((v) => !v)}
              aria-expanded={outlinePanelOpen}
            >
              <p className="outline-panel-title inline-flex items-center gap-2">
                <ListTree size={15} />
                大纲选择
                {!outlinePanelOpen && hasSelectedOutline ? (
                  <span className="outline-panel-summary">
                    · 方案 {(article.selectedOutlineIndex ?? 0) + 1}
                    · {outlines[article.selectedOutlineIndex ?? 0]?.sections?.length ?? 0} 章
                  </span>
                ) : null}
              </p>
              <span className="collapse-toggle">{outlinePanelOpen ? "收起" : "展开"}</span>
            </button>

            {outlinePanelOpen && (
              <>
                <div className="outline-tab-strip">
                  {outlines.map((option) => {
                    const isActive = option.index === activeOutlineView;
                    const isSelected = option.index === article.selectedOutlineIndex;
                    return (
                      <button
                        key={option.index}
                        type="button"
                        onClick={() => {
                          setActiveOutlineView(option.index);
                          setExpandedOutlineSection(null);
                        }}
                        className={`outline-tab-btn ${isActive ? "outline-tab-btn-active" : ""} ${isSelected ? "outline-tab-btn-selected" : ""}`}
                      >
                        <span className="outline-tab-label">
                          方案 {option.index + 1}
                          {isSelected ? " · 已选" : ""}
                        </span>
                        <span className="outline-tab-name" title={option.title}>
                          {option.title}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {viewingOutline ? (
                  <div className="outline-detail-panel">
                    <p className="outline-detail-desc">{viewingOutline.positioning}</p>
                    <div className="outline-sections-grid">
                      {viewingOutline.sections.map((s, idx) => {
                        const open = expandedOutlineSection === idx;
                        return (
                          <div
                            key={idx}
                            className={`outline-section-compact ${open ? "outline-section-compact-open" : ""}`}
                          >
                            <button
                              type="button"
                              className="outline-section-compact-toggle"
                              onClick={() =>
                                setExpandedOutlineSection((cur) => (cur === idx ? null : idx))
                              }
                              aria-expanded={open}
                            >
                              <span className="outline-section-compact-head">
                                <span className="outline-section-compact-num">{idx + 1}</span>
                                <span>{s.heading}</span>
                              </span>
                              <span className="outline-section-chevron" aria-hidden>
                                {open ? "−" : "+"}
                              </span>
                            </button>
                            <p className="outline-section-compact-summary">{s.summary}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="outline-detail-actions">
                      <p className="text-xs text-[var(--muted)]">
                        当前查看方案 {viewingOutline.index + 1}
                      </p>
                      <button
                        onClick={() => selectOutline(viewingOutline.index)}
                        disabled={busy !== null}
                        className={`rounded-full px-5 py-2.5 text-sm transition-all ${
                          viewingSelected
                            ? "inline-flex items-center gap-1.5 bg-[var(--accent-soft)] text-[var(--accent)] border border-[rgba(37,99,235,0.25)] font-semibold"
                            : "btn-secondary"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {viewingSelected ? (
                          <>
                            <Check size={14} />
                            已选这个大纲
                          </>
                        ) : busy === "选择大纲" ? (
                          "选择中..."
                        ) : (
                          "选择这个大纲"
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>
        )}

        <div className="mobile-stage-actions">
          <WorkflowButton
            busy={busy}
            label="重新生成大纲"
            icon={<RefreshCw size={14} />}
            onClick={() => callAction(`/api/articles/${id}/generate-outline`, "重新生成大纲")}
          />
          <WorkflowButton
            busy={busy}
            label="生成正文"
            icon={<FileText size={14} />}
            onClick={() => {
              setMobileStage("content");
              setOutlinePanelOpen(false);
              void callAction(`/api/articles/${id}/generate-content`, "生成正文");
            }}
            disabled={!hasSelectedOutline}
            title={hasSelectedOutline ? undefined : "请先选择一个大纲"}
            className="workflow-btn-primary"
          />
        </div>
        </div>

        <div
          className={`mobile-stage-panel ${mobileStage === "content" ? "mobile-stage-panel-active" : ""}`}
          data-stage="content"
        >
        <div className="workflow-bar workflow-bar-desktop stage-order-workflow">
          <span className="workflow-bar-label">AI 操作</span>
          <WorkflowButton
            busy={busy}
            label="重新生成大纲"
            icon={<RefreshCw size={14} />}
            onClick={() => callAction(`/api/articles/${id}/generate-outline`, "重新生成大纲")}
          />
          <WorkflowButton
            busy={busy}
            label="生成正文"
            icon={<FileText size={14} />}
            onClick={() => callAction(`/api/articles/${id}/generate-content`, "生成正文")}
            disabled={!hasSelectedOutline}
            title={hasSelectedOutline ? undefined : "请先在下方大纲区点击「选择这个大纲」"}
            className="workflow-item-mobile-only"
          />
          <WorkflowButton
            busy={busy}
            label="风险检测"
            icon={<Shield size={14} />}
            onClick={() => callAction(`/api/articles/${id}/risk-check`, "风险检测")}
          />
          <button
            onClick={() => {
              setPushResult(null);
              setPushDialogOpen(true);
            }}
            disabled={busy !== null || !article.content}
            className="workflow-btn workflow-btn-primary workflow-item-mobile-only"
          >
            <Send size={14} />
            推送草稿箱
          </button>
          {article.title ? (
            <button
              type="button"
              onClick={() => copyTitle(article.title ?? "")}
              className="workflow-btn ml-auto"
              title="复制标题"
            >
              <Copy size={14} />
              复制标题
            </button>
          ) : null}
        </div>

        <div className="mobile-stage-actions">
          <WorkflowButton
            busy={busy}
            label="风险检测"
            icon={<Shield size={14} />}
            onClick={() => callAction(`/api/articles/${id}/risk-check`, "风险检测")}
          />
          {article.title ? (
            <button
              type="button"
              onClick={() => copyTitle(article.title ?? "")}
              className="workflow-btn"
              title="复制标题"
            >
              <Copy size={14} />
              复制标题
            </button>
          ) : null}
        </div>

        <div className="editor-panel stage-order-editor">
          <div className="editor-panel-head">
            <div className="editor-tabs !border-0 !bg-transparent !p-0">
              <button
                type="button"
                onClick={() => setEditorTab("meta")}
                className={`editor-tab ${editorTab === "meta" ? "editor-tab-active" : ""}`}
              >
                元信息
              </button>
              <button
                type="button"
                onClick={() => setEditorTab("content")}
                className={`editor-tab ${editorTab === "content" ? "editor-tab-active" : ""}`}
              >
                正文 HTML
              </button>
            </div>
          </div>

          <div className="editor-panel-body">
            {editorTab === "meta" ? (
              <div className="editor-field-stack">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <FieldLabel>标题</FieldLabel>
                    <input
                      type="text"
                      value={article.title ?? ""}
                      onChange={(e) => setArticle((a) => (a ? { ...a, title: e.target.value } : a))}
                      className="mt-2 w-full px-4 py-3 text-lg"
                      placeholder="主标题"
                    />
                    {titleCandidates.length > 0 ? (
                      <div className="title-candidates mt-4">
                        <div className="title-candidates-head">
                          <p className="text-xs font-semibold text-[var(--muted)]">备选标题 · 点击应用</p>
                          <button
                            type="button"
                            onClick={() => setTitleCandidates([])}
                            className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                          >
                            清除
                          </button>
                        </div>
                        <ul className="title-candidates-list">
                          {titleCandidates.map((item) => {
                            const active = item.text === article.title;
                            return (
                              <li key={`${item.style}-${item.text}`}>
                                <button
                                  type="button"
                                  onClick={() => applyTitleCandidate(item.text)}
                                  className={`title-candidate-btn ${active ? "title-candidate-btn-active" : ""}`}
                                >
                                  <span className="title-candidate-style">{item.style}</span>
                                  <span className="title-candidate-text">{item.text}</span>
                                  {active ? <Check size={14} className="shrink-0 text-[var(--accent)]" /> : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel>摘要</FieldLabel>
                    <textarea
                      value={article.summary ?? ""}
                      onChange={(e) => setArticle((a) => (a ? { ...a, summary: e.target.value } : a))}
                      className="mt-2 min-h-[100px] w-full px-4 py-3 text-sm leading-6"
                      placeholder="公众号会展示在标题下方的简介"
                    />
                  </div>
                  {article.coverImageUrl ? (
                    <div>
                      <FieldLabel>封面图</FieldLabel>
                      <div className="cover-preview mt-2">
                        <img src={article.coverImageUrl} alt="cover" />
                        <span className="cover-preview-label">封面预览</span>
                      </div>
                    </div>
                  ) : (
                    <div className="md:col-span-2">
                      <div className="info-banner">
                        <Image size={18} className="info-banner-icon" />
                        <p>尚未生成封面图，可使用下方「生成封面图」快捷工具。</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <FieldLabel>正文 HTML</FieldLabel>
                <textarea
                  value={article.content ?? ""}
                  onChange={(e) => setArticle((a) => (a ? { ...a, content: e.target.value } : a))}
                  className="html-editor mt-2"
                  placeholder="在此编辑或粘贴 HTML 正文..."
                />
              </div>
            )}
          </div>
        </div>

        <div className="stage-order-content-tools">
          <p className="tool-section-label tool-section-label-content">正文工具</p>
          <div className="tool-chip-grid">
            <ActionChip busy={busy} label="生成备选标题" onClick={handleGenerateTitles} />
            <ActionChip busy={busy} label="生成摘要" onClick={handleGenerateSummary} disabled={!article.content && !article.topic} />
            <ActionChip busy={busy} label="扩写正文" onClick={() => callAction(`/api/articles/${id}/expand`, "扩写正文")} disabled={!article.content} />
            <ActionChip busy={busy} label="全文润色" onClick={() => callAction(`/api/articles/${id}/polish`, "全文润色")} disabled={!article.content} />
            <ActionChip busy={busy} label="章节配图" onClick={() => callAction(`/api/articles/${id}/generate-inline-images`, "生成章节配图")} disabled={!article.content} />
            <ActionChip
              busy={busy}
              label="刷新正文格式"
              onClick={() => callAction(`/api/articles/${id}/highlight-code`, "刷新正文格式")}
              disabled={!article.content}
            />
          </div>
        </div>
        </div>

        <div
          className={`mobile-stage-panel ${mobileStage === "publish" ? "mobile-stage-panel-active" : ""}`}
          data-stage="publish"
        >
        {(pushResult?.draftId || pushRecords.length > 0) && (
          <div className="space-y-2 stage-order-push">
            {pushResult && pushResult.draftId ? (
              <div className="push-inline border-[rgba(5,150,105,0.25)] bg-[var(--success-soft)]">
                <span className="text-sm font-semibold text-[var(--success)]">✓ 推送成功</span>
                <a
                  href="https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  前往微信公众平台 →
                </a>
              </div>
            ) : null}
            {pushRecords.length > 0 ? (
              <details className="push-inline">
                <summary className="cursor-pointer text-sm font-medium">
                  推送历史 · {pushRecords.length} 条
                </summary>
                <div className="mt-3 w-full space-y-2">
                  {pushRecords.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`badge ${r.status === "success" ? "badge-success" : "badge-danger"}`}>
                          {r.status === "success" ? "成功" : "失败"}
                        </span>
                        <span className="text-[var(--muted)]">
                          {new Date(r.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {r.errorMessage ? (
                        <span className="truncate text-[var(--danger)]" title={r.errorMessage}>
                          {r.errorMessage}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}

        <div className="stage-order-publish-tools">
          <p className="tool-section-label tool-section-label-publish">发布工具</p>
          <div className="tool-chip-grid">
            <ActionChip
              busy={busy}
              label="文章预览"
              onClick={() => setPreviewOpen(true)}
              disabled={!article.content}
            />
            <ActionChip busy={busy} label="生成封面图" onClick={() => callAction(`/api/articles/${id}/generate-cover`, "生成封面图")} />
            <ActionChip
              busy={busy}
              label="推送草稿箱"
              onClick={() => {
                setPushResult(null);
                setPushDialogOpen(true);
              }}
              disabled={!article.content}
            />
          </div>
        </div>
        </div>
      </div>

      <PreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={article.title ?? article.topic}
        summary={article.summary}
        content={article.content}
        coverImageUrl={article.coverImageUrl}
        topic={article.topic}
        targetWords={article.wordCount}
      />

      <ProgressDialog
        key={progressKey}
        open={progress.open}
        title={progress.title}
        steps={progress.steps}
        generatedCount={progress.generatedCount}
        totalCount={progress.totalCount}
        error={progress.error}
        startedAt={progress.startedAt}
        onCancel={requestCancelCurrent}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        title={busy ? `取消「${busy}」？` : "取消当前任务？"}
        description={article ? (article.title ?? article.topic) : undefined}
        confirmLabel="确认取消"
        onConfirm={cancelCurrent}
        onCancel={() => setCancelConfirmOpen(false)}
      />

      <PushDialog
        open={pushDialogOpen}
        onClose={() => setPushDialogOpen(false)}
        onConfirm={handlePushConfirm}
        busy={busy !== null}
        title={article.title ?? article.topic}
        summary={article.summary}
        coverImageUrl={article.coverImageUrl}
        wordCount={plainCharCount}
        targetWords={article.wordCount}
      />

      {!pushDialogOpen && !previewOpen && !progress.open && !cancelConfirmOpen ? (
      <div className="mobile-editor-dock">
        <button
          type="button"
          onClick={() => void saveArticle()}
          disabled={saving}
          className="mobile-editor-dock-btn mobile-editor-dock-btn-secondary"
        >
          <Save size={16} />
          {saving ? "保存中" : "保存"}
        </button>
        {mobileStage === "outline" ? (
          <button
            type="button"
            onClick={() => {
              setMobileStage("content");
              setOutlinePanelOpen(false);
              void callAction(`/api/articles/${id}/generate-content`, "生成正文");
            }}
            disabled={busy !== null || !hasSelectedOutline}
            className="mobile-editor-dock-btn mobile-editor-dock-btn-primary"
          >
            <FileText size={16} />
            {busy === "生成正文" ? "生成中" : "生成正文"}
          </button>
        ) : mobileStage === "content" ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            disabled={!article.content}
            className="mobile-editor-dock-btn mobile-editor-dock-btn-primary"
          >
            <Eye size={16} />
            预览
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setPushResult(null);
              setPushDialogOpen(true);
            }}
            disabled={busy !== null || !article.content}
            className="mobile-editor-dock-btn mobile-editor-dock-btn-primary"
          >
            <Send size={16} />
            推送
          </button>
        )}
      </div>
      ) : null}
    </>
  );
}

function ActionChip({
  busy,
  label,
  activeLabel,
  onClick,
  disabled,
}: {
  busy: string | null;
  label: string;
  activeLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const key = activeLabel ?? label;
  const isLoading = busy === key;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null || disabled}
      className="tool-chip"
    >
      {isLoading ? `${label}中...` : label}
    </button>
  );
}

function WorkflowButton({
  busy,
  label,
  icon,
  onClick,
  disabled,
  title,
  className,
}: {
  busy: string | null;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const isLoading = busy === label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null || disabled}
      title={title}
      className={`workflow-btn ${className ?? ""}`}
    >
      {icon}
      {isLoading ? `${label}中...` : label}
    </button>
  );
}

function plainTextLengthFromHtml(html: string) {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  }
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\s+/g, "").length;
}

function normalizeTitleText(text: string) {
  return text
    .replace(/[\s：:，,。.!?！？\-—|「」『』""''（）()【】\[\]《》<>·]/g, "")
    .toLowerCase();
}

function getTitleBigrams(text: string) {
  const normalized = normalizeTitleText(text);
  const bigrams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  return bigrams;
}

function countFiguresInHtml(html: string) {
  return (html.match(/<figure\b/gi) ?? []).length;
}

function getInlineImageProgressFromContent(html: string) {
  let maxProgress = 0;
  for (const match of html.matchAll(/<figure\b[^>]*\sdata-progress="(\d+)\/\d+"/gi)) {
    maxProgress = Math.max(maxProgress, Number(match[1]) || 0);
  }
  return maxProgress;
}

/** 判断备选标题是否与大纲方案标题明显不一致 */
function isTitleDivergedFromOutline(nextTitle: string, outlineTitle: string) {
  const a = normalizeTitleText(nextTitle);
  const b = normalizeTitleText(outlineTitle);
  if (!a || !b) return false;
  if (a === b) return false;
  if (a.includes(b) || b.includes(a)) return false;

  const bigramsA = getTitleBigrams(nextTitle);
  const bigramsB = getTitleBigrams(outlineTitle);
  if (bigramsA.size === 0 || bigramsB.size === 0) {
    return a !== b;
  }

  let overlap = 0;
  for (const gram of bigramsA) {
    if (bigramsB.has(gram)) overlap += 1;
  }
  const similarity = overlap / Math.max(bigramsA.size, bigramsB.size);
  return similarity < 0.38;
}
