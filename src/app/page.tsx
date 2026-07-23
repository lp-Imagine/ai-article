"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { FieldLabel, PageHeader, SectionCard } from "@/components/app-shell";
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
  { step: "01", label: "填写主题" },
  { step: "02", label: "选择大纲" },
  { step: "03", label: "生成正文" },
  { step: "04", label: "推送草稿" },
];

type ApiResponse<T> = { code: number; message: string; data: T };

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    topic: "",
    keywords: "",
    style: "干货型",
    wordCount: 1200,
    audience: "",
    goal: "知识分享",
    outlineCount: 3,
  });
  const [recent, setRecent] = useState<RecentArticle[]>([]);
  const { runningTaskIds } = useArticleBackgroundTasks();

  useEffect(() => {
    fetchRecent();
  }, []);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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

  return (
    <>
      <PageHeader
        eyebrow="Editorial Workspace"
        title="Draftly · 内容工作台"
        description="从一个主题出发，到推送到公众号草稿箱。把选题、大纲、正文、配图、检测、发布收进同一条工作流。"
        className="home-page-header"
      />

      <div className="workflow-steps home-workflow-steps mb-8">
        {workflowSteps.map((item) => (
          <div key={item.step} className="workflow-step">
            <p className="workflow-step-num">{item.step}</p>
            <p className="workflow-step-label">{item.label}</p>
          </div>
        ))}
      </div>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)] home-workspace">
        <div data-tour="home-create">
        <SectionCard
          title="快速开始"
          description="填一个主题，先让 AI 按你选的数量给出大纲方案，确定方向后再生成正文。"
          className="home-create-card"
        >
          <form className="home-create-form space-y-6" onSubmit={handleSubmit}>
            <div>
              <FieldLabel>主题 / 标题</FieldLabel>
              <input
                type="text"
                value={form.topic}
                onChange={(e) => update("topic", e.target.value)}
                placeholder="例如：用 React 做流式 AI 对话界面 / 普通人如何用 AI 提升效率"
                className="mt-2 w-full px-4 py-3.5 text-base"
              />
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

            <button
              type="submit"
              disabled={loading || !form.topic.trim()}
              className="home-create-submit w-full btn-primary py-3.5 text-sm"
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
          </form>
        </SectionCard>
        </div>

        <SectionCard
          title="最近文章"
          description="继续编辑未完成的内容"
          className="h-fit"
          headerExtra={
            <button onClick={fetchRecent} className="btn-ghost inline-flex items-center gap-1 text-xs">
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
    </>
  );
}
