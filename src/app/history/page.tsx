"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ListPagination } from "@/components/list-pagination";
import { PageHeader, SectionCard } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import {
  cancelArticleBackgroundTask,
  getArticleBackgroundTask,
} from "@/lib/article-task-tracker";
import { useArticleBackgroundTasks } from "@/hooks/use-article-background-tasks";
import { DEFAULT_PAGE_SIZE, type PaginatedData } from "@/lib/pagination";

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Article | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const { runningTaskIds } = useArticleBackgroundTasks();

  const fetchPage = useCallback(async (targetPage: number, mode: "replace" | "append") => {
    if (mode === "append") setLoadingMore(true);
    else setLoading(true);

    try {
      const res = await fetch(`/api/articles?page=${targetPage}&limit=${pageSize}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.code !== 0 || !json.data) {
        throw new Error(json.message || "加载失败");
      }
      const data = json.data as PaginatedData<Article>;
      setTotal(data.total);
      setPage(data.page);
      setArticles((prev) => (mode === "append" ? [...prev, ...data.items] : data.items));
      if (mode === "replace") setSelectedIds(new Set());
    } catch {
      toast.show({ message: "加载历史失败", variant: "error" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [pageSize, toast]);

  useEffect(() => {
    void fetchPage(1, "replace");
  }, [fetchPage]);

  const allSelected = articles.length > 0 && selectedIds.size === articles.length;
  const someSelected = selectedIds.size > 0;
  const selectedCount = selectedIds.size;

  const selectedTitlesPreview = useMemo(() => {
    const selected = articles.filter((a) => selectedIds.has(a.id));
    if (selected.length === 0) return "";
    const names = selected.slice(0, 3).map((a) => a.title ?? a.topic);
    if (selected.length <= 3) return names.join("、");
    return `${names.join("、")} 等 ${selected.length} 篇`;
  }, [articles, selectedIds]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(articles.map((a) => a.id)));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;

    const { id } = pendingDelete;
    setDeletingId(id);
    setPendingDelete(null);

    cancelArticleBackgroundTask(id);

    try {
      const res = await fetch(`/api/articles/${id}?action=delete`, { method: "POST" });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || "删除失败");
      }
      toast.show({ message: "文章已删除", variant: "success" });
      const nextTotal = Math.max(0, total - 1);
      const totalPages = nextTotal === 0 ? 0 : Math.ceil(nextTotal / pageSize);
      const nextPage = totalPages === 0 ? 1 : Math.min(page, totalPages);
      await fetchPage(nextPage, "replace");
    } catch (err) {
      const message = err instanceof Error ? err.message : "删除失败";
      toast.show({ message, variant: "error" });
    } finally {
      setDeletingId(null);
    }
  }

  async function confirmBatchDelete() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBatchConfirmOpen(false);
    setBatchDeleting(true);

    for (const id of ids) {
      cancelArticleBackgroundTask(id);
    }

    try {
      const res = await fetch("/api/articles?action=delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || "批量删除失败");
      }
      const deleted = typeof json.data?.deleted === "number" ? json.data.deleted : ids.length;
      toast.show({ message: `已删除 ${deleted} 篇文章`, variant: "success" });
      const nextTotal = Math.max(0, total - deleted);
      const totalPages = nextTotal === 0 ? 0 : Math.ceil(nextTotal / pageSize);
      const nextPage = totalPages === 0 ? 1 : Math.min(page, totalPages);
      await fetchPage(nextPage, "replace");
    } catch (err) {
      const message = err instanceof Error ? err.message : "批量删除失败";
      toast.show({ message, variant: "error" });
    } finally {
      setBatchDeleting(false);
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

      <ConfirmDialog
        open={batchConfirmOpen}
        title={`删除选中的 ${selectedCount} 篇文章？`}
        description={
          selectedCount > 0
            ? `将删除「${selectedTitlesPreview}」，删除后无法恢复。`
            : undefined
        }
        confirmLabel="全部删除"
        onConfirm={() => void confirmBatchDelete()}
        onCancel={() => setBatchConfirmOpen(false)}
      />

      <PageHeader
        eyebrow="Archive"
        title="历史记录"
        description="过往创建的所有文章，点击继续编辑或查看进度。"
      />

      <SectionCard
        title={`全部文章${total > 0 ? ` · ${total}` : ""}`}
        headerExtra={
          !loading && articles.length > 0 ? (
            <div className="history-toolbar">
              <label className="history-select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={toggleSelectAll}
                  disabled={batchDeleting}
                />
                <span>{allSelected ? "取消全选" : "全选本页"}</span>
              </label>
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={!someSelected || batchDeleting}
                onClick={() => setBatchConfirmOpen(true)}
              >
                <Trash2 size={14} />
                {batchDeleting ? "删除中…" : `批量删除${someSelected ? ` (${selectedCount})` : ""}`}
              </button>
            </div>
          ) : null
        }
      >
        {loading && articles.length === 0 ? (
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
          <>
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
                const isDeleting = deletingId === article.id || batchDeleting;
                const isSelected = selectedIds.has(article.id);
                const metaParts = [
                  article.style,
                  article.wordCount ? `${article.wordCount} 字` : null,
                ].filter(Boolean);

                return (
                  <div
                    key={article.id}
                    className={`history-row${isSelected ? " history-row-selected" : ""}`}
                  >
                    <label className="history-row-check">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={batchDeleting}
                        onChange={() => toggleSelect(article.id)}
                        aria-label={`选择「${displayTitle}」`}
                      />
                    </label>
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
            <ListPagination
              page={page}
              total={total}
              pageSize={pageSize}
              loading={loading}
              loadingMore={loadingMore}
              onPageChange={(next) => void fetchPage(next, "replace")}
              onLoadMore={() => void fetchPage(page + 1, "append")}
            />
          </>
        )}
      </SectionCard>
    </>
  );
}
