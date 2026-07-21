"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, FileText } from "lucide-react";
import { PageHeader, SectionCard } from "@/components/app-shell";

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
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  return (
    <>
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
          <div className="space-y-3">
            {articles.map((article) => (
              <Link key={article.id} href={`/articles/${article.id}`} className="history-row">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">
                    {article.title ?? article.topic}
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                    {article.topic}
                    {article.style ? ` · ${article.style}` : ""}
                    {article.wordCount ? ` · ${article.wordCount} 字` : ""}
                    {" · "}
                    {new Date(article.updatedAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`badge ${statusBadge[article.status] ?? "badge-muted"}`}>
                    {statusLabel[article.status] ?? article.status}
                  </span>
                  <ArrowRight size={16} className="text-[var(--muted)]" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
