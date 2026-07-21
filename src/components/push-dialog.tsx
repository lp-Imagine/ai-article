"use client";

import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  title: string;
  summary?: string | null;
  coverImageUrl?: string | null;
  wordCount: number;
  targetWords?: number | null;
};

export default function PushDialog({
  open,
  onClose,
  onConfirm,
  busy,
  title,
  summary,
  coverImageUrl,
  wordCount,
  targetWords,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(21,19,17,0.35)] backdrop-blur-md p-4 mobile-dialog-sheet sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="glass-strong w-[480px] max-w-[90vw] max-h-[85vh] overflow-auto rounded-[24px] sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-5">
          <h2 className="editorial-title text-xl font-semibold text-[var(--foreground)]">
            推送确认
          </h2>

          {/* 封面预览 */}
          {coverImageUrl ? (
            <div>
              <Label>封面图</Label>
              <img
                src={coverImageUrl}
                alt="封面"
                className="mt-2 w-full h-40 rounded-lg border border-[var(--line)] object-cover"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--warning)] bg-[var(--warning-soft)] p-4 text-sm text-[#b45309]">
              暂未生成封面图，推送时系统将自动生成一张。
            </div>
          )}

          {/* 标题 & 摘要 */}
          <div>
            <Label>标题</Label>
            <p className="mt-1.5 text-base font-semibold text-[var(--foreground)] leading-snug">
              {title}
            </p>
          </div>
          <div>
            <Label>摘要</Label>
            <p className="mt-1.5 text-sm text-[var(--muted)] leading-relaxed">
              {summary || "（未填写摘要，将截取正文前段）"}
            </p>
          </div>

          {/* 字数 */}
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            <span>{wordCount} 字</span>
            {targetWords ? (
              <span className="badge badge-accent">目标 {targetWords} 字</span>
            ) : null}
          </div>

          {/* 提示 */}
          <div className="rounded-lg border border-[rgba(0,113,227,0.15)] bg-[var(--accent-soft)] p-3 text-xs text-[var(--accent)]">
            推送后将作为草稿保存到微信公众号后台，不会立即发布。你可以在微信公众平台草稿箱中预览和编辑。
          </div>

          {/* 按钮 */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm" disabled={busy}>
              取消
            </button>
            <button onClick={onConfirm} className="btn-primary flex-1 py-2.5 text-sm" disabled={busy}>
              {busy ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  推送中...
                </span>
              ) : (
                "确认推送"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs uppercase tracking-widest text-[var(--muted)]">
      {children}
    </span>
  );
}
