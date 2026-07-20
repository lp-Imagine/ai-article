"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
    <main className="mx-auto w-full max-w-[960px] px-8 py-12">
      <div className="flex items-center justify-between border-b border-[var(--line)] pb-6">
        <div>
          <Link href="/" className="btn-ghost text-xs mb-2 inline-block">
            ← 返回工作台
          </Link>
          <h1 className="editorial-title text-3xl font-bold">历史记录</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">过往创建的所有文章</p>
        </div>
      </div>

      <section className="mt-8">
        {loading ? (
          <div className="glass p-8 text-center text-sm text-[var(--muted)]">加载中...</div>
        ) : articles.length === 0 ? (
          <div className="glass p-8 text-center">
            <p className="text-sm text-[var(--muted)]">暂无历史文章</p>
            <Link href="/" className="mt-3 inline-block btn-primary text-sm py-2 px-6">
              去创作第一篇文章
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {articles.map((article) => (
              <Link
                key={article.id}
                href={`/articles/${article.id}`}
                className="glass flex items-center justify-between p-4 transition-all hover:border-[var(--line-strong)]"
              >
                <div className="min-w-0 pr-4">
                  <h2 className="text-sm font-medium truncate">
                    {article.title ?? article.topic}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">
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
                <span className={`badge shrink-0 ${statusBadge[article.status] ?? "badge-muted"}`}>
                  {statusLabel[article.status] ?? article.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
