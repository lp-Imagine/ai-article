"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileUp, Lightbulb, Link2, RefreshCw, Sparkles, Zap } from "lucide-react";
import { FieldLabel, PageHeader, SectionCard } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import {
  clearArticleBackgroundTask,
  emitArticleBackgroundTaskFinished,
  getArticleBackgroundTask,
  patchArticleBackgroundTask,
  reconcileBackgroundTaskAfterRequestFailure,
  registerArticleTaskAbortController,
  startArticleBackgroundTask,
  unregisterArticleTaskAbortController,
  waitForGenerationJob,
} from "@/lib/article-task-tracker";
import { readApiResponse } from "@/lib/api-client";
import { useArticleBackgroundTasks } from "@/hooks/use-article-background-tasks";
import {
  extractTitleFromContent,
  IMPORT_CONTENT_MAX_CHARS,
  IMPORT_FILE_EXTENSIONS,
  isSupportedImportFilename,
} from "@/lib/import-parse-helpers";

type ImportSource = "paste" | "file" | "url";

const IMPORT_ACCEPT = IMPORT_FILE_EXTENSIONS.join(",");

type RecentArticle = {
  id: string;
  title: string | null;
  topic: string;
  status: string;
  updatedAt: string;
};

const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "badge-muted" },
  outlined: { label: "已选大纲", color: "badge-accent" },
  generated: { label: "已生成正文", color: "badge-warning" },
  edited: { label: "已修改", color: "badge-accent" },
  checked: { label: "已检测", color: "badge-success" },
  pushed: { label: "已推送", color: "badge-success" },
  failed: { label: "推送失败", color: "badge-danger" },
};

const workflowSteps = [
  { step: "01", label: "定主题" },
  { step: "02", label: "选大纲" },
  { step: "03", label: "出正文" },
  { step: "04", label: "推草稿" },
];

type ApiResponse<T> = { code: number; message: string; data: T };

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [createMode, setCreateMode] = useState<"ai" | "import">("ai");
  const [form, setForm] = useState({
    topic: "",
    keywords: "",
    style: "干货型",
    wordCount: 1200,
    audience: "",
    goal: "知识分享",
    outlineCount: 3,
  });
  const [quickGenerateConfirm, setQuickGenerateConfirm] = useState<string | null>(null);
  const [quickAutoPush, setQuickAutoPush] = useState(false);
  const [importForm, setImportForm] = useState({
    title: "",
    content: "",
    summary: "",
  });
  const [importSource, setImportSource] = useState<ImportSource>("paste");
  const [importUrl, setImportUrl] = useState("");
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [urlFetching, setUrlFetching] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<RecentArticle[]>([]);
  const { runningTaskIds } = useArticleBackgroundTasks();

  // Topic Ideas state
  type TopicIdea = { topic: string; reason: string; source: string; score: number; tags?: string[] };
  type IdeasFilter = "all" | "history" | "hot";
  const [ideas, setIdeas] = useState<TopicIdea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasCursor, setIdeasCursor] = useState(0);
  const [ideasFilter, setIdeasFilter] = useState<IdeasFilter>("all");
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [ideasEmptyReason, setIdeasEmptyReason] = useState<string | null>(null);

  async function fetchIdeas(cursor = 0, filter: IdeasFilter = ideasFilter, opts?: { refresh?: boolean }) {
    if (filter !== ideasFilter || opts?.refresh) {
      setIdeas([]);
      setIdeasEmptyReason(null);
    }
    setIdeasLoading(true);
    try {
      const params = new URLSearchParams({
        count: "8",
        cursor: String(cursor),
        mode: filter,
      });
      // 换一批：强制重新调模型生成热点（历史模式本身不走 LLM）
      if (opts?.refresh && filter !== "history") {
        params.set("refresh", "1");
      }
      const res = await fetch(`/api/topic-ideas?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (json.code === 0 && json.data) {
        const nextIdeas = (json.data.ideas ?? []) as TopicIdea[];
        setIdeas(nextIdeas);
        setIdeasCursor(cursor);
        setIdeasFilter(filter);
        setIdeasOpen(true);
        setIdeasEmptyReason(nextIdeas.length ? null : json.data.emptyReason || "暂时没有建议");
        if (!nextIdeas.length && !json.data.emptyReason) {
          toast.show({ message: "暂时没有建议，请稍后再试", variant: "warning" });
        }
      } else {
        toast.show({ message: "暂时没有建议，请稍后再试", variant: "warning" });
      }
    } catch {
      toast.show({ message: "获取灵感失败，请重试", variant: "error" });
    } finally {
      setIdeasLoading(false);
    }
  }

  useEffect(() => {
    fetchRecent();
    void fetch("/api/topic-ideas?count=8&cursor=0&mode=all", { cache: "no-store" }).catch(() => {});
  }, []);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateImport<K extends keyof typeof importForm>(key: K, value: (typeof importForm)[K]) {
    setImportForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyImportedDraft(next: {
    title?: string | null;
    content: string;
    summary?: string | null;
    fileName?: string | null;
  }) {
    const content = next.content.slice(0, IMPORT_CONTENT_MAX_CHARS);
    setImportForm((prev) => {
      const guessed = extractTitleFromContent(content);
      return {
        title: (next.title?.trim() || prev.title.trim() || guessed || "").slice(0, 200),
        content,
        summary: (next.summary?.trim() || prev.summary).slice(0, 500),
      };
    });
    if (next.fileName !== undefined) {
      setImportFileName(next.fileName);
    }
  }

  async function readImportFile(file: File) {
    if (!isSupportedImportFilename(file.name)) {
      toast.show({
        message: `仅支持 ${IMPORT_FILE_EXTENSIONS.join(" / ")} 文件`,
        variant: "warning",
      });
      return;
    }
    if (file.size > 2_500_000) {
      toast.show({ message: "文件过大（建议 2.5MB 以内）", variant: "warning" });
      return;
    }
    const text = await file.text();
    if (!text.trim()) {
      toast.show({ message: "文件内容为空", variant: "warning" });
      return;
    }
    const fromName = file.name.replace(/\.[^.]+$/, "").trim();
    applyImportedDraft({
      content: text,
      title: fromName.length >= 2 ? fromName.slice(0, 80) : null,
      fileName: file.name,
    });
    setImportSource("paste");
    toast.show({ message: `已载入「${file.name}」，可核对后导入`, variant: "success", duration: 2800 });
  }

  async function handleImportUrlFetch() {
    const url = importUrl.trim();
    if (!url || urlFetching || loading) return;
    setUrlFetching(true);
    try {
      const res = await fetch("/api/articles/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await readApiResponse<{
        title: string;
        content: string;
        summary: string | null;
        sourceUrl?: string;
      }>(res);
      if (json.code !== 0 || !json.data?.content) {
        throw new Error(json.message || "网页抓取失败");
      }
      applyImportedDraft({
        title: json.data.title,
        content: json.data.content,
        summary: json.data.summary,
        fileName: null,
      });
      setImportSource("paste");
      toast.show({ message: "已从网页提取正文，请核对后导入", variant: "success", duration: 3000 });
    } catch (err) {
      toast.show({
        title: "抓取失败",
        message: err instanceof Error ? err.message : "网页抓取失败",
        variant: "error",
        duration: 6000,
      });
    } finally {
      setUrlFetching(false);
    }
  }

  async function fetchRecent() {
    try {
      const res = await fetch("/api/articles?page=1&limit=5", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<{ items: RecentArticle[] }>;
      if (json.code === 0 && json.data?.items?.length > 0) {
        setRecent(json.data.items);
      }
    } catch {
      // ignore
    }
  }

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!importForm.content.trim() || loading) return;

    const title =
      importForm.title.trim() ||
      extractTitleFromContent(importForm.content)?.trim() ||
      "";
    if (!title) {
      toast.show({ message: "请填写标题，或在正文开头加 # 标题", variant: "warning" });
      return;
    }
    if (!importForm.title.trim()) {
      updateImport("title", title);
    }
    setLoading(true);

    try {
      // Base64 编码正文，降低宝塔 WAF 对代码片段误拦截导致空响应的概率
      const contentBase64 =
        typeof window !== "undefined"
          ? window.btoa(unescape(encodeURIComponent(importForm.content)))
          : Buffer.from(importForm.content, "utf8").toString("base64");

      const created = await fetch("/api/articles/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content: contentBase64,
          contentEncoding: "base64",
          summary: importForm.summary.trim() || null,
          autoReformat: true,
        }),
      });
      const createdJson = await readApiResponse<{
        id: string;
        jobId?: string | null;
        reformatQueued?: boolean;
        reformatSkippedReason?: string | null;
      }>(created);
      if (createdJson.code !== 0 || !createdJson.data?.id) {
        throw new Error(createdJson.message || "导入失败");
      }

      const articleId = createdJson.data.id;
      const jobId = createdJson.data.jobId ?? null;

      if (jobId) {
        startArticleBackgroundTask({
          articleId,
          label: "整理格式",
          title: "正在整理正文格式",
          articleLabel: title,
          startedAt: Date.now(),
          statusAtStart: "edited",
          contentLengthAtStart: importForm.content.length,
          jobId,
        });
        toast.show({
          message: "文章已导入，正在自动整理格式…",
          variant: "success",
        });
      } else {
        const skip = createdJson.data.reformatSkippedReason;
        toast.show({
          message: skip
            ? `文章已导入（${skip}）。可在编辑页手动点「整理格式」。`
            : "文章已导入，可继续润色、配图或推送",
          variant: skip ? "warning" : "success",
          duration: skip ? 6000 : 4000,
        });
      }

      router.push(`/articles/${articleId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      toast.show({ title: "导入失败", message, variant: "error", duration: 6000 });
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.topic.trim() || loading) return;
    setLoading(true);
    const topic = form.topic.trim();

    try {
      const created = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          keywords: form.keywords,
          style: form.style,
          wordCount: Number(form.wordCount),
          audience: form.audience,
          goal: form.goal,
          outlineCount: form.outlineCount,
        }),
      });
      const createdJson = (await created.json()) as ApiResponse<{ id: string }>;
      if (createdJson.code !== 0) {
        throw new Error(createdJson.message || "创建失败");
      }
      const articleId = createdJson.data.id;
      const ctrl = new AbortController();

      startArticleBackgroundTask({
        articleId,
        label: "生成大纲",
        title: "正在生成大纲方案",
        articleLabel: topic,
        startedAt: Date.now(),
        statusAtStart: "draft",
        contentLengthAtStart: 0,
      });
      registerArticleTaskAbortController(articleId, ctrl);

      void fetch(`/api/articles/${articleId}/generate-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outlineCount: form.outlineCount }),
        signal: ctrl.signal,
      })
        .then(async (res) => {
          const outlineJson = await readApiResponse<{ jobId?: string }>(res);
          if (outlineJson.code !== 0) {
            throw new Error(outlineJson.message || "生成大纲失败");
          }
          const jobId = outlineJson.data?.jobId;
          if (!jobId) {
            throw new Error("未返回任务 ID");
          }
          patchArticleBackgroundTask(articleId, { jobId });
          const job = await waitForGenerationJob(jobId, { signal: ctrl.signal });
          if (job.status === "failed" || job.status === "cancelled") {
            throw new Error(job.error || "生成大纲失败");
          }
        })
        .then(() => {
          clearArticleBackgroundTask(articleId);
          emitArticleBackgroundTaskFinished({
            articleId,
            label: "生成大纲",
            status: "succeeded",
          });
          unregisterArticleTaskAbortController(articleId, ctrl);
        })
        .catch(async (err) => {
          unregisterArticleTaskAbortController(articleId, ctrl);
          if (err instanceof Error && err.name === "AbortError") {
            clearArticleBackgroundTask(articleId);
            return;
          }

          const task = getArticleBackgroundTask(articleId);
          if (task) {
            const outcome = await reconcileBackgroundTaskAfterRequestFailure(task);
            if (outcome === "completed") {
              clearArticleBackgroundTask(articleId);
              emitArticleBackgroundTaskFinished({
                articleId,
                label: "生成大纲",
                status: "succeeded",
              });
              return;
            }
            if (outcome === "pending") {
              return;
            }
          }

          clearArticleBackgroundTask(articleId);
          const message = err instanceof Error ? err.message : "生成大纲失败";
          emitArticleBackgroundTaskFinished({
            articleId,
            label: "生成大纲",
            status: "failed",
            error: message,
          });
          toast.show({ title: "生成大纲失败", message, variant: "error", duration: 6000 });
        });

      router.push(`/articles/${articleId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      toast.show({ title: "创建失败", message, variant: "error", duration: 6000 });
      setLoading(false);
    }
  }

  /**
   * 快捷生成：点按钮时先弹确认框，可选择生成后是否自动推送微信草稿。
   * 一键完成 大纲 → 自动采用方案 → 正文（含精炼 + 封面）→（可选）推送。
   */
  function openQuickGenerateConfirm(topicOverride?: string) {
    const topic = (topicOverride ?? form.topic).trim();
    if (!topic || loading) return;
    setQuickAutoPush(false);
    setQuickGenerateConfirm(topic);
  }

  async function handleQuickGenerate(topic: string, autoPush: boolean) {
    if (!topic || loading) return;
    setLoading(true);

    try {
      const res = await fetch("/api/articles/quick-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          keywords: form.keywords,
          style: form.style,
          wordCount: Number(form.wordCount),
          audience: form.audience,
          goal: form.goal,
          outlineCount: form.outlineCount,
          autoPush,
        }),
      });
      const json = (await res.json()) as ApiResponse<{
        article: { id: string };
        jobId: string;
      }>;
      if (json.code !== 0) {
        throw new Error(json.message || "快捷生成失败");
      }
      const articleId = json.data.article.id;
      const jobId = json.data.jobId;

      startArticleBackgroundTask({
        articleId,
        label: "快捷生成",
        title: "正在快捷生成文章",
        articleLabel: topic,
        startedAt: Date.now(),
        statusAtStart: "draft",
        contentLengthAtStart: 0,
        jobId,
      });

      void waitForGenerationJob(jobId)
        .then((job) => {
          clearArticleBackgroundTask(articleId);
          if (job.status === "failed" || job.status === "cancelled") {
            emitArticleBackgroundTaskFinished({
              articleId,
              label: "快捷生成",
              status: "failed",
              error: job.error || "快捷生成失败",
            });
            toast.show({
              title: "快捷生成失败",
              message: job.error || "任务执行失败",
              variant: "error",
              duration: 6000,
            });
          } else {
            emitArticleBackgroundTaskFinished({
              articleId,
              label: "快捷生成",
              status: "succeeded",
            });
            toast.show({
              message: "快捷生成完成，大纲与正文已就绪",
              variant: "success",
            });
          }
        })
        .catch((err) => {
          clearArticleBackgroundTask(articleId);
          emitArticleBackgroundTaskFinished({
            articleId,
            label: "快捷生成",
            status: "failed",
            error: err instanceof Error ? err.message : "快捷生成失败",
          });
        });

      toast.show({
        message: "快捷生成已开始：大纲与正文将自动完成，无需中途操作",
        variant: "success",
        duration: 5000,
      });
      router.push(`/articles/${articleId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "快捷生成失败";
      toast.show({ title: "快捷生成失败", message, variant: "error", duration: 6000 });
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Draftly · 内容工作台"
        description="主题一填，大纲、正文、配图到公众号草稿箱一次做完；已有文稿也能导入继续打磨。"
        className="home-page-header"
      />

      <div className="workflow-steps home-workflow-steps mb-6">
        {workflowSteps.map((item) => (
          <div key={item.step} className="workflow-step">
            <p className="workflow-step-num">{item.step}</p>
            <p className="workflow-step-label">{item.label}</p>
          </div>
        ))}
      </div>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] home-workspace">
        <div data-tour="home-create">
          <SectionCard
            title="快速开始"
            description={
              createMode === "ai"
                ? "写好主题后生成多套大纲，选定方向再出正文。"
                : "粘贴、上传或抓取网页；导入后可润色、配图并推送。"
            }
            className="home-create-card"
            headerExtra={
              <span className="home-card-icon" aria-hidden>
                <Sparkles size={16} />
              </span>
            }
          >
            <div className="home-create-mode-tabs" role="tablist" aria-label="创作方式">
              <button
                type="button"
                role="tab"
                aria-selected={createMode === "ai"}
                className={`home-create-mode-tab${createMode === "ai" ? " home-create-mode-tab-active" : ""}`}
                onClick={() => setCreateMode("ai")}
              >
                <Sparkles size={15} />
                AI 创作
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={createMode === "import"}
                className={`home-create-mode-tab${createMode === "import" ? " home-create-mode-tab-active" : ""}`}
                onClick={() => setCreateMode("import")}
              >
                <FileUp size={15} />
                导入文章
              </button>
            </div>

            {createMode === "ai" ? (
              <form className="home-create-form space-y-6" onSubmit={handleSubmit}>
                <div className="home-topic-block">
                  <div className="home-topic-head">
                    <FieldLabel>主题 / 标题</FieldLabel>
                    <button
                      type="button"
                      disabled={ideasLoading}
                      onClick={() => (ideasOpen ? setIdeasOpen(false) : fetchIdeas(0))}
                      className={`home-inspire-btn${ideasOpen ? " home-inspire-btn-active" : ""}`}
                      aria-expanded={ideasOpen}
                    >
                      {ideasLoading ? (
                        <span className="home-inspire-spinner" aria-hidden />
                      ) : (
                        <Lightbulb size={14} strokeWidth={2.1} />
                      )}
                      <span>{ideasOpen ? "收起灵感" : "给我灵感"}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={form.topic}
                    onChange={(e) => update("topic", e.target.value)}
                    placeholder="例如：用 React 做流式 AI 对话界面 / 普通人如何用 AI 提升效率"
                    className="mt-2 w-full px-4 py-3.5 text-base"
                  />

                  {ideasOpen && (
                    <div className="topic-ideas-panel" aria-live="polite">
                      <div className="topic-ideas-toolbar">
                        <div className="topic-ideas-filters" role="tablist" aria-label="灵感筛选">
                          {(
                            [
                              { id: "all" as const, label: "综合", hint: "历史 + 热点混合" },
                              { id: "history" as const, label: "历史", hint: "基于你写过的文章" },
                              { id: "hot" as const, label: "热点", hint: "当下技术热点" },
                            ] as const
                          ).map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              role="tab"
                              title={f.hint}
                              aria-selected={ideasFilter === f.id}
                              disabled={ideasLoading}
                              onClick={() => {
                                if (ideasFilter === f.id) return;
                                void fetchIdeas(0, f.id);
                              }}
                              className={`topic-ideas-filter${ideasFilter === f.id ? " topic-ideas-filter-active" : ""}`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void fetchIdeas(ideasCursor + 1, ideasFilter, { refresh: true })}
                          disabled={ideasLoading || (ideasFilter === "history" && ideas.length === 0)}
                          className="topic-ideas-refresh"
                        >
                          <RefreshCw size={12} className={ideasLoading ? "animate-spin" : ""} />
                          换一批
                        </button>
                      </div>

                      <p className="topic-ideas-caption">
                        {ideasFilter === "history"
                          ? "从你最近写过的主题延伸，不含通用热点。"
                          : ideasFilter === "hot"
                            ? "当下前端 / AI / 全栈热点，不含历史偏好。"
                            : "历史延伸与技术热点混合，点选一条填入主题。"}
                      </p>

                      {ideasLoading && ideas.length === 0 ? (
                        <div className="topic-ideas-loading">
                          <span className="home-inspire-spinner" aria-hidden />
                          <span>正在挑选选题…</span>
                        </div>
                      ) : ideas.length === 0 ? (
                        <div className="topic-ideas-empty">
                          <p>{ideasEmptyReason || "暂时没有建议"}</p>
                          {ideasFilter === "history" ? (
                            <button
                              type="button"
                              className="topic-ideas-empty-action"
                              onClick={() => void fetchIdeas(0, "hot")}
                            >
                              看看热点
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <ul className="topic-ideas-list">
                          {ideas.map((idea, idx) => {
                            const sourceLabel =
                              idea.source === "history"
                                ? "历史"
                                : idea.source === "hot"
                                  ? "热点"
                                  : idea.source === "mixed"
                                    ? "混合"
                                    : "模板";
                            return (
                              <li key={`${idea.topic}-${idx}`} className="topic-idea-wrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    update("topic", idea.topic);
                                    setIdeasOpen(false);
                                    toast.show({
                                      message: "已填入主题，可直接生成大纲",
                                      variant: "success",
                                      duration: 2500,
                                    });
                                    fetch("/api/topic-ideas", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ topic: idea.topic }),
                                    }).catch(() => {});
                                  }}
                                  className="topic-idea-item"
                                >
                                  <div className="topic-idea-item-top">
                                    <span className={`topic-idea-source topic-idea-source-${idea.source}`}>
                                      {sourceLabel}
                                    </span>
                                    {idea.tags?.find((t) => t !== sourceLabel) ? (
                                      <span className="topic-idea-tag">
                                        {idea.tags.find((t) => t !== sourceLabel)}
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="topic-idea-title">{idea.topic}</p>
                                  {idea.reason ? (
                                    <p className="topic-idea-reason">{idea.reason}</p>
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  className="topic-idea-quick-generate"
                                  title="快捷生成全文：大纲自动采用，直接出正文"
                                  disabled={loading}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIdeasOpen(false);
                                    openQuickGenerateConfirm(idea.topic);
                                  }}
                                >
                                  <Zap size={13} />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <FieldLabel>关键词</FieldLabel>
                  <input
                    type="text"
                    value={form.keywords}
                    onChange={(e) => update("keywords", e.target.value)}
                    placeholder="可选，多个用逗号分隔"
                    className="mt-2 w-full px-4 py-2.5 text-sm"
                  />
                </div>

                <div className="field-grid field-grid-2 home-create-primary-grid">
                  <div>
                    <FieldLabel>文章风格</FieldLabel>
                    <select
                      value={form.style}
                      onChange={(e) => update("style", e.target.value)}
                      className="mt-2 w-full px-4 py-2.5 text-sm"
                    >
                      <option>干货型</option>
                      <option>观点型</option>
                      <option>故事型</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel>目标字数</FieldLabel>
                    <select
                      value={form.wordCount}
                      onChange={(e) => update("wordCount", Number(e.target.value))}
                      className="mt-2 w-full px-4 py-2.5 text-sm"
                    >
                      <option value={800}>800</option>
                      <option value={1200}>1,200</option>
                      <option value={1500}>1,500</option>
                      <option value={2000}>2,000</option>
                      <option value={3000}>3,000</option>
                      <option value={4000}>4,000</option>
                      <option value={5000}>5,000</option>
                    </select>
                  </div>
                </div>

                <input
                  type="checkbox"
                  id="home-create-more-toggle"
                  className="home-create-more-toggle"
                />
                <label htmlFor="home-create-more-toggle" className="home-create-more-summary">
                  更多选项
                  <span className="home-create-more-hint">读者 / 目标 / 大纲数</span>
                </label>
                <div className="field-grid field-grid-2 home-create-more-grid">
                  <div>
                    <FieldLabel>目标读者</FieldLabel>
                    <input
                      type="text"
                      value={form.audience}
                      onChange={(e) => update("audience", e.target.value)}
                      placeholder="例如：前端开发者 / 职场新人"
                      className="mt-2 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <FieldLabel>文章目标</FieldLabel>
                    <select
                      value={form.goal}
                      onChange={(e) => update("goal", e.target.value)}
                      className="mt-2 w-full px-4 py-2.5 text-sm"
                    >
                      <option>知识分享</option>
                      <option>涨粉</option>
                      <option>转化</option>
                      <option>品牌表达</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel>大纲方案数</FieldLabel>
                    <select
                      value={form.outlineCount}
                      onChange={(e) => update("outlineCount", Number(e.target.value))}
                      className="mt-2 w-full px-4 py-2.5 text-sm"
                    >
                      <option value={2}>2 个</option>
                      <option value={3}>3 个（默认）</option>
                      <option value={4}>4 个</option>
                      <option value={5}>5 个</option>
                      <option value={6}>6 个</option>
                    </select>
                  </div>
                </div>

                <div className="home-create-actions">
                  <button
                    type="submit"
                    disabled={loading || !form.topic.trim()}
                    className="home-create-submit btn-primary py-3.5 text-sm"
                  >
                    {loading ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        生成大纲中...
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center gap-2">
                        生成大纲
                        <ArrowRight size={16} />
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => openQuickGenerateConfirm()}
                    disabled={loading || !form.topic.trim()}
                    className="home-create-submit quick-generate-btn py-3.5 text-sm"
                    title="一键生成：大纲自动采用，直接出正文，无需中途选择"
                  >
                    {loading ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        快捷生成中...
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Zap size={16} />
                        快捷生成全文
                      </span>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <form className="home-create-form space-y-6" onSubmit={handleImportSubmit}>
                <div className="home-import-source-tabs" role="tablist" aria-label="导入方式">
                  {(
                    [
                      { id: "paste" as const, label: "粘贴" },
                      { id: "file" as const, label: "上传文件" },
                      { id: "url" as const, label: "网页链接" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={importSource === tab.id}
                      className={`home-import-source-tab${importSource === tab.id ? " home-import-source-tab-active" : ""}`}
                      onClick={() => setImportSource(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {importSource === "file" && (
                  <div
                    className={`home-import-dropzone${fileDragOver ? " home-import-dropzone-active" : ""}`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setFileDragOver(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setFileDragOver(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setFileDragOver(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setFileDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) void readImportFile(file);
                    }}
                  >
                    <input
                      ref={importFileInputRef}
                      type="file"
                      accept={IMPORT_ACCEPT}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void readImportFile(file);
                      }}
                    />
                    <FileUp size={22} className="text-[var(--accent)]" aria-hidden />
                    <p className="mt-2 text-sm font-medium">拖拽文件到此处，或点击选择</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      支持 {IMPORT_FILE_EXTENSIONS.join(" / ")}
                    </p>
                    <button
                      type="button"
                      className="btn-ghost mt-3 text-xs"
                      onClick={() => importFileInputRef.current?.click()}
                    >
                      选择文件
                    </button>
                    {importFileName && (
                      <p className="mt-2 text-xs text-[var(--muted)]">最近载入：{importFileName}</p>
                    )}
                  </div>
                )}

                {importSource === "url" && (
                  <div className="space-y-3">
                    <div>
                      <FieldLabel>公开网页链接</FieldLabel>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <input
                          type="url"
                          value={importUrl}
                          onChange={(e) => setImportUrl(e.target.value)}
                          placeholder="https://… 博客、公众号文章页等"
                          className="w-full flex-1 px-4 py-2.5 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleImportUrlFetch();
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={urlFetching || !importUrl.trim()}
                          onClick={() => void handleImportUrlFetch()}
                          className="btn-ghost inline-flex shrink-0 items-center justify-center gap-1.5 px-4 py-2.5 text-sm"
                        >
                          {urlFetching ? (
                            <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <Link2 size={14} />
                          )}
                          {urlFetching ? "抓取中…" : "抓取正文"}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        会尽量抽取标题与正文；微信等站点若拦截抓取，请改用复制粘贴或导出 HTML。
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <FieldLabel>标题</FieldLabel>
                  <input
                    type="text"
                    value={importForm.title}
                    onChange={(e) => updateImport("title", e.target.value)}
                    placeholder="可留空，将尝试从正文自动识别"
                    className="mt-2 w-full px-4 py-3.5 text-base"
                    maxLength={200}
                  />
                </div>
                <div>
                  <FieldLabel>正文</FieldLabel>
                  <textarea
                    value={importForm.content}
                    onChange={(e) => {
                      const content = e.target.value;
                      setImportForm((prev) => {
                        const next = { ...prev, content };
                        if (!prev.title.trim()) {
                          const guessed = extractTitleFromContent(content);
                          if (guessed) next.title = guessed;
                        }
                        return next;
                      });
                    }}
                    onPaste={(e) => {
                      const html = e.clipboardData.getData("text/html");
                      const plain = e.clipboardData.getData("text/plain");
                      // 富文本粘贴：优先保留 HTML，便于后续清理管线识别
                      if (html && html.includes("<") && html.length > (plain?.length || 0) + 20) {
                        e.preventDefault();
                        applyImportedDraft({ content: html });
                        setImportSource("paste");
                      }
                    }}
                    placeholder={
                      "粘贴纯文本、Markdown 或从网页复制的内容。例如：\n\n## 小节标题\n\n正文段落，可用 **加粗**。\n\n- 列表项一\n- 列表项二"
                    }
                    className="mt-2 min-h-[220px] w-full px-4 py-3 text-sm leading-6"
                    required
                  />
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    支持纯文本、Markdown、HTML；从 Word / 浏览器复制时会优先保留富文本结构。
                  </p>
                </div>
                <div>
                  <FieldLabel>摘要（可选）</FieldLabel>
                  <textarea
                    value={importForm.summary}
                    onChange={(e) => updateImport("summary", e.target.value)}
                    placeholder="公众号标题下方简介，可稍后在编辑页生成或修改"
                    className="mt-2 min-h-[80px] w-full px-4 py-3 text-sm leading-6"
                    maxLength={500}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !importForm.content.trim()}
                  className="home-create-submit w-full btn-primary py-3.5 text-sm"
                >
                  {loading ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      导入中...
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center gap-2">
                      导入并整理
                      <ArrowRight size={16} />
                    </span>
                  )}
                </button>
              </form>
            )}
          </SectionCard>
        </div>

        <SectionCard
          title="最近文章"
          description="未完成的继续改，已推送的也能回来改。"
          className="home-recent-card"
          headerExtra={
            <button
              onClick={fetchRecent}
              className="btn-ghost inline-flex items-center gap-1 text-xs"
            >
              <RefreshCw size={12} />
              刷新
            </button>
          }
        >
          {recent.length === 0 ? (
            <div className="empty-state py-10">
              <p className="text-sm text-[var(--muted)]">还没有文章，在左侧开始创作吧</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {recent.slice(0, 6).map((item) => {
                const s = statusMap[item.status] ?? statusMap.draft;
                const backgroundTask = getArticleBackgroundTask(item.id);
                const isRunning = runningTaskIds.has(item.id);
                return (
                  <li key={item.id}>
                    <Link href={`/articles/${item.id}`} className="recent-item">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {item.title ?? item.topic}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {new Date(item.updatedAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                        {isRunning ? (
                          <span className="badge badge-accent">
                            {backgroundTask?.label ?? "生成中"}…
                          </span>
                        ) : null}
                        <span className={`badge ${s.color}`}>{s.label}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </section>

      <ConfirmDialog
        open={quickGenerateConfirm !== null}
        title="快捷生成全文"
        description="将一键完成：大纲自动采用 → 生成正文（含精炼与封面）→ 可选推送微信草稿。"
        confirmLabel="开始生成"
        cancelLabel="取消"
        onConfirm={() => {
          const topic = quickGenerateConfirm;
          setQuickGenerateConfirm(null);
          if (topic) void handleQuickGenerate(topic, quickAutoPush);
        }}
        onCancel={() => setQuickGenerateConfirm(null)}
      >
        <label className="confirm-dialog-check-row">
          <input
            type="checkbox"
            checked={quickAutoPush}
            onChange={(e) => setQuickAutoPush(e.target.checked)}
          />
          <span>
            生成完成后<strong>自动推送到微信草稿箱</strong>
            <span className="confirm-dialog-check-hint">
              需已在「设置 → 微信公众号」配置 App ID / Secret
            </span>
          </span>
        </label>
      </ConfirmDialog>
    </>
  );
}
