"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";

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

  useEffect(() => {
    fetchRecent();
  }, []);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function fetchRecent() {
    try {
      const res = await fetch("/api/articles", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<RecentArticle[]>;
      if (json.code === 0 && json.data && json.data.length > 0) {
        setRecent(json.data);
      }
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.topic.trim()) return;
    setLoading(true);
    try {
      const created = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: form.topic.trim(),
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

      const outlineRes = await fetch(`/api/articles/${articleId}/generate-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outlineCount: form.outlineCount }),
      });
      const outlineJson = await outlineRes.json();
      if (outlineJson.code !== 0) {
        throw new Error(outlineJson.message || "生成大纲失败");
      }

      router.push(`/articles/${articleId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      toast.show({ title: "创建失败", message, variant: "error", duration: 6000 });
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-8 py-12">
      {/* 顶部标题区 */}
      <header className="flex items-end justify-between border-b border-[var(--line)] pb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
            AI-Powered Editorial Workspace
          </p>
          <h1 className="editorial-title mt-2 text-4xl font-bold bg-gradient-to-r from-[var(--accent)] via-[#4da8ff] to-[#a78bfa] bg-clip-text text-transparent">
            公众号 AI 发文助手
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
            从一个主题出发，到推送到公众号草稿箱。把选题、大纲、正文、配图、检测、发布收进同一条工作流。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings" className="btn-secondary text-sm py-2">
            设置
          </Link>
          <Link href="/history" className="btn-secondary text-sm py-2">
            查看历史
          </Link>
        </div>
      </header>

      <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        {/* 快速开始表单 */}
        <div className="glass p-6">
          <h2 className="editorial-title text-2xl font-semibold">快速开始</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            填一个主题，先让 AI 给出 2 到 3 个大纲方案，确定方向后再生成正文。
          </p>
          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="text-xs uppercase tracking-widest text-[var(--muted)]">主题 / 标题</label>
              <input
                type="text"
                value={form.topic}
                onChange={(e) => update("topic", e.target.value)}
                placeholder="例如：用 React 做流式 AI 对话界面 / 普通人如何用 AI 提升效率"
                className="mt-2 w-full px-4 py-3 text-base"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-[var(--muted)]">关键词</label>
              <input
                type="text"
                value={form.keywords}
                onChange={(e) => update("keywords", e.target.value)}
                placeholder="可选，多个用逗号分隔"
                className="mt-2 w-full px-4 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs uppercase tracking-widest text-[var(--muted)]">文章风格</label>
                <select
                  value={form.style}
                  onChange={(e) => update("style", e.target.value)}
                  className="mt-2 w-full px-4 py-2 text-sm"
                >
                  <option>干货型</option>
                  <option>观点型</option>
                  <option>故事型</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-[var(--muted)]">目标字数</label>
                <select
                  value={form.wordCount}
                  onChange={(e) => update("wordCount", Number(e.target.value))}
                  className="mt-2 w-full px-4 py-2 text-sm"
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs uppercase tracking-widest text-[var(--muted)]">目标读者</label>
                <input
                  type="text"
                  value={form.audience}
                  onChange={(e) => update("audience", e.target.value)}
                  placeholder="例如：前端开发者 / 职场新人 / 泛读者"
                  className="mt-2 w-full px-4 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-[var(--muted)]">文章目标</label>
                <select
                  value={form.goal}
                  onChange={(e) => update("goal", e.target.value)}
                  className="mt-2 w-full px-4 py-2 text-sm"
                >
                  <option>知识分享</option>
                  <option>涨粉</option>
                  <option>转化</option>
                  <option>品牌表达</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs uppercase tracking-widest text-[var(--muted)]">大纲方案数</label>
                <select
                  value={form.outlineCount}
                  onChange={(e) => update("outlineCount", Number(e.target.value))}
                  className="mt-2 w-full px-4 py-2 text-sm"
                >
                  <option value={2}>2 个</option>
                  <option value={3}>3 个（默认）</option>
                  <option value={4}>4 个</option>
                  <option value={5}>5 个</option>
                  <option value={6}>6 个</option>
                </select>
              </div>
              <div aria-hidden className="hidden sm:block" />
            </div>

            <button
              type="submit"
              disabled={loading || !form.topic.trim()}
              className="w-full btn-primary py-3 text-sm"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  生成大纲中...
                </span>
              ) : (
                "生成大纲 →"
              )}
            </button>
          </form>
        </div>

        {/* 最近文章 */}
        <aside className="glass p-6 h-fit">
          <div className="flex items-center justify-between">
            <h2 className="editorial-title text-xl font-semibold">最近文章</h2>
            <button onClick={fetchRecent} className="btn-ghost text-xs">
              刷新 ↻
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--muted)] text-center py-8">
              还没有文章，在上方开始创作吧
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--line)]">
              {recent.slice(0, 6).map((item) => {
                const s = statusMap[item.status] ?? statusMap.draft;
                return (
                  <li key={item.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0 pr-3">
                      <Link
                        href={`/articles/${item.id}`}
                        className="block truncate text-sm font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors"
                      >
                        {item.title ?? item.topic}
                      </Link>
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(item.updatedAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <span className={`badge shrink-0 ${s.color}`}>{s.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </section>
    </main>
  );
}
