"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader, SectionCard } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import {
  cancelArticleBackgroundTask,
  getArticleBackgroundTask,
} from "@/lib/article-task-tracker";
import { useArticleBackgroundTasks } from "@/hooks/use-article-background-tasks";

type Article = {
  id: string;
  topic: string;
  title: string | null;
  status: string;
  style: string | null;
  wordCount: number | null;
  updatedAt: string;
};

const statusBadge: Record<string, string> = {
  draft: "badge-muted",
  outlined: "badge-accent",
  generated: "badge-warning",
  edited: "badge-accent",
  checked: "badge-success",
  pushed: "badge-success",
  failed: "badge-danger",
};

const statusLabel: Record<string, string> = {
  draft: "草稿",
  outlined: "已选大纲",
  generated: "已生成正文",
  edited: "已修改",
  checked: "已检测",
  pushed: "已推送",
  failed: "推送失败",
};

export default function HistoryPage() {
  const toast = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Article | null>(null);
  const { runningTaskIds } = useArticleBackgroundTasks();

  const loadArticles = useCallback(async () => {
    try {
      const res = await fetch("/api/articles", { cache: "no-store" });
      const json = await res.json();
      if (json.code === 0 && Array.isArray(json.data)) {
        setArticles(json.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  async function confirmDelete() {
    if (!pendingDelete) return;

    const { id } = pendingDelete;
    setDeletingId(id);
    setPendingDelete(null);

    cancelArticleBackgroundTask(id);

    try {
      const res = await fetch(`/api/articles/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || "删除失败");
      }
      setArticles((prev) => prev.filter((item) => item.id !== id));
      toast.show({ message: "文章已删除", variant: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "删除失败";
      toast.show({ message, variant: "error" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这篇文章？"
        description={
          pendingDelete
            ? `「${pendingDelete.title ?? pendingDelete.topic}」删除后无法恢复。`
            : undefined
        }
        confirmLabel="删除"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      <PageHeader
        eyebrow="Archive"
        title="历史记录"
        description="过往创建的所有文章，点击继续编辑或查看进度。"
      />

      <SectionCard title={`全部文章${articles.length > 0 ? ` · ${articles.length}` : ""}`}>
        {loading ? (
          <div className="flex items-center gap-3 py-12 text-sm text-[var(--muted)]">
            <span className="loading-dot" />
            加载中...
          </div>
        ) : articles.length === 0 ? (
          <div className="empty-state">
            <FileText size={28} className="mx-auto mb-3 text-[var(--muted)]" strokeWidth={1.5} />
            <p className="text-sm text-[var(--muted)]">暂无历史文章</p>
            <Link href="/" className="mt-4 inline-block btn-primary text-sm py-2.5 px-6">
              去创作第一篇文章
            </Link>
          </div>
        ) : (
          <div className="history-list">
            {articles.map((article) => {
              const displayTitle = article.title ?? article.topic;
              const showTopic = Boolean(article.title && article.topic !== article.title);
              const updatedLabel = new Date(article.updatedAt).toLocaleString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });
              const backgroundTask = getArticleBackgroundTask(article.id);
              const isRunning = runningTaskIds.has(article.id);
              const isDeleting = deletingId === article.id;
              const metaParts = [
                article.style,
                article.wordCount ? `${article.wordCount} 字` : null,
              ].filter(Boolean);

              return (
                <div key={article.id} className="history-row">
                  <Link href={`/articles/${article.id}`} className="history-row-main">
                    <div className="history-row-top">
                      <h2 className="history-row-title">{displayTitle}</h2>
                      <span className={`badge ${statusBadge[article.status] ?? "badge-muted"}`}>
                        {statusLabel[article.status] ?? article.status}
                      </span>
                    </div>
                    {showTopic ? <p className="history-row-topic">{article.topic}</p> : null}
                    <div className="history-row-meta">
                      {isRunning ? (
                        <span className="history-row-running">
                          {backgroundTask?.label ?? "生成中"}…
                        </span>
                      ) : null}
                      {metaParts.length > 0 ? (
                        <span className="history-row-meta-text">{metaParts.join(" · ")}</span>
                      ) : null}
                      <time className="history-row-time" dateTime={article.updatedAt}>
                        {updatedLabel}
                      </time>
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="history-row-delete"
                    aria-label={`删除「${displayTitle}」`}
                    disabled={isDeleting}
                    onClick={() => setPendingDelete(article)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </>
  );
}
