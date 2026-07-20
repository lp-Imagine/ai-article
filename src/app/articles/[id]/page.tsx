"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PreviewDialog from "@/components/preview-dialog";
import PushDialog from "@/components/push-dialog";
import { useToast } from "@/components/toast";
import { ProgressDialog, type ProgressStep } from "@/components/progress-dialog";

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
  "生成正文": { title: "正在生成正文与封面图", estimatedSeconds: 60 },
  "生成章节配图": { title: "正在为各章节生成配图", estimatedSeconds: 90 },
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
  const [progress, setProgress] = useState<{
    open: boolean;
    title: string;
    steps: ProgressStep[];
    generatedCount?: number;
    totalCount?: number;
    error?: string | null;
  }>({ open: false, title: "", steps: [] });

  const toast = useToast();
  const abortRef = useRef<AbortController | null>(null);

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
    const res = await fetch(`/api/articles/${id}`, { cache: "no-store" });
    const json = (await res.json()) as ApiResponse<ArticleRecord>;
    if (json.code === 0 && json.data) {
      setArticle(json.data);
    } else {
      toast.show({ message: json.message || "文章不存在", variant: "error" });
    }
    setLoading(false);
  }, [id, toast]);

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
      } else {
        toast.show({ message: json.message || "文章不存在", variant: "error" });
      }
      setLoading(false);
    })();
    fetchPushHistory();
  }, [id, toast]);

  function cancelCurrent() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null);
    setProgress((p) => ({ ...p, open: false }));
    toast.show({ message: "已取消当前操作", variant: "info" });
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

    if (isLong) {
      const totalSections = isInlineImages
        ? (article?.content?.match(/<h2[^>]*>/g)?.length ?? 0) - 1
        : 1;
      setProgress({
        open: true,
        title: longCfg.title,
        steps: [
          { label: "准备工作", status: "running" },
          isInlineImages
            ? { label: "正在生成第 1 张配图", status: "pending" }
            : { label: "调用 AI 生成中", status: "pending" },
          { label: "保存到草稿", status: "pending" },
        ],
        generatedCount: 0,
        totalCount: Math.max(1, totalSections),
        error: null,
      });
    }

    const toastId = toast.show({
      message: `${label}中...`,
      variant: "info",
      duration: 0,
    });

    let pollingTimer: ReturnType<typeof setInterval> | undefined;
    if (isInlineImages) {
      pollingTimer = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/articles/${id}?t=${Date.now()}`, {
            cache: "no-store",
            signal: ctrl.signal,
          });
          const pollJson = (await pollRes.json()) as ApiResponse<ArticleRecord>;
          if (pollJson.code === 0 && pollJson.data?.content) {
            const figureCount = (pollJson.data.content.match(/<figure/g) ?? []).length;
            if (figureCount > 0) {
              setProgress((p) => {
                const total = p.totalCount || 1;
                return {
                  ...p,
                  generatedCount: Math.min(figureCount, total),
                  steps: p.steps.map((s, i) =>
                    i === 0
                      ? { ...s, status: "done" }
                      : i === 1
                        ? { ...s, status: "running", label: `正在生成第 ${figureCount + 1} 张配图` }
                        : s,
                  ),
                };
              });
            }
          }
        } catch {
          // ignore
        }
      }, 2000);
    }

    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: ctrl.signal,
      });

      if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = undefined; }

      if (isLong) {
        setProgress((p) => ({
          ...p,
          steps: p.steps.map((s, i) =>
            i === 0 ? { ...s, status: "done" } : i === 1 ? { ...s, status: "done", label: isInlineImages ? `已生成配图` : `${label}完成` } : i === 2 ? { ...s, status: "running" } : s,
          ),
        }));
      }

      const json = (await res.json()) as ApiResponse<{
        content?: string;
        images?: Array<{ heading: string; url: string }>;
        total?: number;
      }>;

      if (json.code !== 0) {
        throw new Error(json.message || `${label} 失败`);
      }

      await refresh();

      if (isLong) {
        setProgress((p) => ({
          ...p,
          generatedCount: isInlineImages ? (json.data?.total ?? json.data?.images?.length ?? p.totalCount) : p.totalCount,
          steps: p.steps.map((s, i) => (i === 2 ? { ...s, status: "done" } : s)),
        }));
      }

      toast.dismiss(toastId);
      toast.show({ title: "操作成功", message: `${label}完成`, variant: "success" });

      if (isLong) {
        setTimeout(() => setProgress((p) => ({ ...p, open: false })), 800);
      }
    } catch (err) {
      if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = undefined; }
      const isAbort = err instanceof Error && err.name === "AbortError";
      toast.dismiss(toastId);

      if (isAbort) {
        if (isLong) {
          setProgress((p) => ({
            ...p,
            error: "用户已取消",
            steps: p.steps.map((s) =>
              s.status === "running" ? { ...s, status: "error" } : s,
            ),
          }));
          setTimeout(() => setProgress((p) => ({ ...p, open: false })), 1200);
        }
      } else {
        const message = err instanceof Error ? err.message : `${label} 失败`;
        toast.show({ title: "操作失败", message, variant: "error", duration: 8000 });
        if (isLong) {
          setProgress((p) => ({
            ...p,
            error: message,
            steps: p.steps.map((s) =>
              s.status === "running" ? { ...s, status: "error" } : s,
            ),
          }));
          setTimeout(() => setProgress((p) => ({ ...p, open: false })), 3000);
        }
      }
    } finally {
      if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = undefined; }
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function handlePushConfirm() {
    setPushDialogOpen(false);
    await callAction(`/api/articles/${id}/push-draft`, "推送公众号草稿箱");
    // refresh to get latest wechatDraftId
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

  async function saveArticle() {
    if (!article) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${id}`, {
        method: "PUT",
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
      toast.show({ message: "草稿已保存", variant: "success" });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      toast.show({ message, variant: "error" });
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
      <main className="mx-auto w-full max-w-[1280px] px-8 py-10">
        <div className="flex items-center gap-3 text-sm muted">
          <span className="inline-block size-2 animate-pulse rounded-full bg-[var(--accent)]" style={{ boxShadow: "0 0 8px var(--accent-glow)" }} />
          加载中...
        </div>
      </main>
    );
  }

  if (!article) {
    return (
      <main className="mx-auto w-full max-w-[1280px] px-8 py-10">
        <div className="glass p-8 text-center">
          <p className="text-lg text-[var(--danger)]">文章不存在或已被删除</p>
          <Link href="/" className="mt-4 inline-block btn-ghost">
            ← 返回工作台
          </Link>
        </div>
      </main>
    );
  }

  const outlines = Array.isArray(article.outline) ? article.outline : [];
  const statusClass = statusVariant[article.status] ?? "badge-muted";

  return (
    <main className="mx-auto w-full max-w-[1280px] px-8 py-10">
      {/* 顶部导航 + 标题 */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/" className="btn-ghost">← 返回工作台</Link>
            <Link href="/settings" className="btn-ghost">设置</Link>
            <Link href="/history" className="btn-ghost">历史记录</Link>
          </div>
          <h1 className="editorial-title mt-3 text-3xl font-semibold text-[var(--foreground)]">
            {article.title ?? article.topic}
          </h1>
          <p className="mt-2 text-sm muted">
            主题：{article.topic}
            {article.style ? ` · ${article.style}` : ""}
            {article.wordCount ? ` · ${article.wordCount} 字` : ""}
          </p>
        </div>
        <div className="text-right">
          <span className={`badge ${statusClass}`}>
            {statusLabel[article.status] ?? article.status}
          </span>
          {article.wechatDraftId ? (
            <p className="mt-2 text-xs muted">草稿 ID：{article.wechatDraftId}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* 左侧：编辑区域 */}
        <section className="glass p-6 space-y-5">
          <div>
            <label className="text-xs uppercase tracking-widest text-[var(--muted)]">标题</label>
            <input
              type="text"
              value={article.title ?? ""}
              onChange={(e) => setArticle((a) => (a ? { ...a, title: e.target.value } : a))}
              className="mt-2 w-full px-4 py-3 text-lg"
              placeholder="主标题"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-[var(--muted)]">摘要</label>
            <textarea
              value={article.summary ?? ""}
              onChange={(e) => setArticle((a) => (a ? { ...a, summary: e.target.value } : a))}
              className="mt-2 min-h-[96px] w-full px-4 py-3 text-sm leading-6"
              placeholder="公众号会展示在标题下方的简介"
            />
          </div>

          {article.coverImageUrl ? (
            <div>
              <label className="text-xs uppercase tracking-widest text-[var(--muted)]">封面图</label>
              <img
                src={article.coverImageUrl}
                alt="cover"
                className="mt-2 h-44 w-full rounded-lg border border-[var(--line)] object-cover"
              />
            </div>
          ) : null}

          <div>
            <label className="text-xs uppercase tracking-widest text-[var(--muted)]">正文 HTML</label>
            <textarea
              value={article.content ?? ""}
              onChange={(e) => setArticle((a) => (a ? { ...a, content: e.target.value } : a))}
              className="mt-2 min-h-[420px] w-full px-4 py-3 font-mono text-sm leading-7"
            />
            {article.wordCount ? (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs muted">
                  <span>字数 {plainCharCount} / 目标 {article.wordCount}</span>
                  <span>{Math.round(targetProgress * 100)}%</span>
                </div>
                <div className="progress-bar mt-1.5">
                  <div
                    className={`progress-bar-fill ${
                      targetProgress >= 0.9
                        ? ""
                        : targetProgress >= 0.6
                          ? ""
                          : ""
                    }`}
                    style={{ width: `${Math.round(targetProgress * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-2.5 pt-2">
            <button onClick={saveArticle} disabled={saving} className="btn-primary">
              {saving ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  保存中...
                </span>
              ) : (
                "保存草稿"
              )}
            </button>
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={!article.content}
              className="btn-secondary"
            >
              预览
            </button>
            <ActionButton busy={busy} activeLabel="生成备选标题" onClick={() => callAction(`/api/articles/${id}/generate-titles`, "生成备选标题")} />
            <ActionButton busy={busy} activeLabel="生成摘要" onClick={() => callAction(`/api/articles/${id}/generate-summary`, "生成摘要")} />
            <ActionButton busy={busy} activeLabel="生成封面图" onClick={() => callAction(`/api/articles/${id}/generate-cover`, "生成封面图")} />
            <ActionButton busy={busy} activeLabel="扩写正文" onClick={() => callAction(`/api/articles/${id}/expand`, "扩写正文")} disabled={!article.content} />
            <ActionButton busy={busy} activeLabel="全文润色" onClick={() => callAction(`/api/articles/${id}/polish`, "全文润色")} disabled={!article.content} />
            <ActionButton busy={busy} activeLabel="生成章节配图" onClick={() => callAction(`/api/articles/${id}/generate-inline-images`, "生成章节配图")} disabled={!article.content} />
            <button
              onClick={() => callAction(`/api/articles/${id}/highlight-code`, "重新高亮代码块")}
              disabled={busy !== null || !article.content}
              className="btn-secondary"
            >
              {busy === "重新高亮代码块" ? "处理中..." : "🔄 重新高亮代码块"}
            </button>
          </div>
        </section>

        {/* 右侧：大纲 + AI 操作 */}
        <aside className="space-y-6">
          {/* 大纲选择 */}
          <section className="glass p-6">
            <h2 className="editorial-title text-lg font-semibold">大纲选择</h2>
            <div className="mt-4 space-y-3">
              {outlines.length === 0 ? (
                <p className="text-sm muted">尚未生成大纲，请回到工作台先触发生成。</p>
              ) : (
                outlines.map((option) => {
                  const selected = option.index === article.selectedOutlineIndex;
                  return (
                    <div
                      key={option.index}
                      className={`rounded-lg border p-4 transition-all ${
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--line)] hover:border-[var(--line-strong)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-sm">{option.title}</p>
                          <p className="mt-1 text-xs muted">{option.positioning}</p>
                        </div>
                        <span className="badge badge-accent shrink-0">
                          方案 {option.index + 1}
                        </span>
                      </div>

                      <ul className="mt-3 space-y-1.5 text-sm leading-6">
                        {option.sections.map((s, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-[var(--accent)]" style={{ boxShadow: "0 0 4px var(--accent-glow)" }} />
                            <span>
                              <span className="font-medium">{s.heading}</span>
                              <span className="muted"> · {s.summary}</span>
                            </span>
                          </li>
                        ))}
                      </ul>

                      <button
                        onClick={() => selectOutline(option.index)}
                        disabled={busy !== null}
                        className={`mt-3 w-full rounded-md py-2 text-sm transition-all ${
                          selected
                            ? "bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]"
                            : "btn-secondary"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {selected ? "✓ 已选这个大纲" : busy === "选择大纲" ? "选择中..." : "选择这个大纲"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* AI 操作 */}
          <section className="glass p-6">
            <h2 className="editorial-title text-lg font-semibold">AI 操作</h2>
            <div className="mt-4 space-y-2.5">
              {[
                { label: "重新生成大纲", path: `/api/articles/${id}/generate-outline` },
                { label: "生成正文", path: `/api/articles/${id}/generate-content` },
                { label: "风险检测", path: `/api/articles/${id}/risk-check` },
              ].map((action) => (
                <ActionButton
                  key={action.label}
                  busy={busy}
                  activeLabel={action.label}
                  onClick={() => callAction(action.path, action.label)}
                  fullWidth
                />
              ))}

              <button
                onClick={() => {
                  setPushResult(null);
                  setPushDialogOpen(true);
                }}
                disabled={busy !== null || !article.content}
                className="mt-3 w-full btn-primary py-2.5 text-sm"
              >
                推送公众号草稿箱
              </button>
            </div>

            {article.title ? (
              <div className="mt-4 rounded-lg border border-[var(--line)] bg-[rgba(0,0,0,0.02)] p-3">
                <p className="text-xs muted">当前标题（点击复制）</p>
                <button
                  onClick={() => copyTitle(article.title ?? "")}
                  className="mt-1 block w-full truncate text-left text-sm font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors"
                >
                  {article.title}
                </button>
              </div>
            ) : null}

            {/* 推送结果 */}
            {pushResult && pushResult.draftId ? (
              <div className="mt-4 rounded-lg border border-[var(--success)] bg-[var(--success-soft)] p-4">
                <p className="text-sm font-semibold text-[var(--success)]">
                  ✓ 推送成功
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  草稿 ID：{pushResult.draftId}
                </p>
                <a
                  href="https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs text-[var(--accent)] hover:underline"
                >
                  前往微信公众平台草稿箱 →
                </a>
              </div>
            ) : null}
          </section>

          {/* 推送历史 */}
          {pushRecords.length > 0 && (
            <section className="glass p-6">
              <h2 className="editorial-title text-lg font-semibold mb-3">推送历史</h2>
              <div className="space-y-2">
                {pushRecords.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm py-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`badge shrink-0 ${r.status === "success" ? "badge-success" : "badge-danger"}`}>
                        {r.status === "success" ? "成功" : "失败"}
                      </span>
                      <span className="text-xs text-[var(--muted)] truncate">
                        {new Date(r.createdAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {r.errorMessage && (
                      <span className="text-xs text-[var(--danger)] ml-2 truncate max-w-[140px]" title={r.errorMessage}>
                        {r.errorMessage.length > 20 ? r.errorMessage.slice(0, 20) + "..." : r.errorMessage}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
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
        open={progress.open}
        title={progress.title}
        steps={progress.steps}
        generatedCount={progress.generatedCount}
        totalCount={progress.totalCount}
        error={progress.error}
        onCancel={cancelCurrent}
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
    </main>
  );
}

function ActionButton({
  busy,
  activeLabel,
  onClick,
  disabled,
  fullWidth,
}: {
  busy: string | null;
  activeLabel: string;
  onClick: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const isLoading = busy === activeLabel;
  const isOtherLoading = busy !== null && !isLoading;
  return (
    <button
      onClick={onClick}
      disabled={busy !== null || disabled}
      className={`${fullWidth ? "w-full" : ""} btn-secondary text-sm`}
    >
      {isLoading ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {activeLabel}中...
        </span>
      ) : isOtherLoading ? (
        <span className="opacity-50">{activeLabel}</span>
      ) : (
        activeLabel
      )}
    </button>
  );
}
