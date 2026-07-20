"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  summary?: string | null;
  content?: string | null;
  coverImageUrl?: string | null;
  topic: string;
  targetWords?: number | null;
};

type Mode = "phone" | "desktop";

function plainTextLength(html: string) {
  if (typeof window === "undefined") return html.length;
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\s+/g, "").length;
}

export default function PreviewDialog({
  open,
  onClose,
  title,
  summary,
  content,
  coverImageUrl,
  topic,
  targetWords,
}: Props) {
  const [mode, setMode] = useState<Mode>("phone");

  if (!open) return null;

  const safeContent = content && content.trim().length > 0
    ? content
    : `<p>（尚无正文）请在左侧生成或粘贴内容，再回到这里预览。</p>`;

  const safeTitle = title || topic || "未命名标题";
  const charCount = plainTextLength(safeContent);
  const ratio = targetWords ? Math.min(1, charCount / targetWords) : 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部栏 */}
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="editorial-title text-lg font-semibold text-[var(--foreground)]">
              预览
            </h3>
            <span className="badge badge-accent">
              {charCount} 字
            </span>
            {targetWords ? (
              <span
                className={
                  ratio >= 0.9
                    ? "badge badge-success"
                    : ratio >= 0.6
                      ? "badge badge-warning"
                      : "badge badge-danger"
                }
              >
                {Math.round(ratio * 100)}% / 目标 {targetWords} 字
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {/* 模式切换 */}
            <div className="flex overflow-hidden rounded-md border border-[var(--line)] text-xs">
              <button
                onClick={() => setMode("phone")}
                className={`px-3 py-1.5 transition-colors ${
                  mode === "phone"
                    ? "bg-[var(--accent)] text-white font-semibold"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                手机
              </button>
              <button
                onClick={() => setMode("desktop")}
                className={`px-3 py-1.5 transition-colors ${
                  mode === "desktop"
                    ? "bg-[var(--accent)] text-white font-semibold"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                电脑
              </button>
            </div>
            <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-3">
              关闭
            </button>
          </div>
        </div>

        {/* 预览区域 */}
        <div className="flex-1 overflow-auto bg-[var(--background)] p-6">
          {mode === "phone" ? (
            <div className="mx-auto flex h-full max-w-[420px] flex-col rounded-[36px] border-[10px] border-[#1a1a2e] bg-white shadow-2xl shadow-black/30">
              <div className="flex items-center justify-between px-4 py-2 text-[10px] text-[#888] border-b border-[#f0f0f0]">
                <span>9:41</span>
                <span className="font-medium">公众号预览</span>
                <span>•••</span>
              </div>
              <div className="flex-1 overflow-auto px-5 py-4 mp-preview">
                {coverImageUrl ? (
                  <img src={coverImageUrl} alt="cover" className="mp-cover" />
                ) : null}
                <h1>{safeTitle}</h1>
                <div className="mp-meta">
                  {summary ? summary : "（未填写摘要）"}
                </div>
                <div dangerouslySetInnerHTML={{ __html: `<article>${safeContent}</article>` }} />
                <div className="mt-8 border-t border-dashed border-[#e6dccb] pt-4 text-center text-xs text-[#999]">
                  — 全文完 —
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl rounded-xl border border-[var(--line)] bg-white shadow-lg">
              <div className="border-b border-[#f0e8d5] bg-[#faf7ef] px-5 py-2.5 text-xs text-[var(--muted)]">
                模拟公众号文章页（桌面宽度）
              </div>
              <div className="mp-preview px-8 py-6">
                {coverImageUrl ? (
                  <img src={coverImageUrl} alt="cover" className="mp-cover" />
                ) : null}
                <h1>{safeTitle}</h1>
                <div className="mp-meta">
                  {summary ? summary : "（未填写摘要）"}
                </div>
                <div dangerouslySetInnerHTML={{ __html: `<article>${safeContent}</article>` }} />
                <div className="mt-10 border-t border-dashed border-[#e6dccb] pt-4 text-center text-xs text-[#999]">
                  — 全文完 —
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
