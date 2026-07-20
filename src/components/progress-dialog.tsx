"use client";

import { useEffect, useRef, useState } from "react";

export type ProgressStep = {
  label: string;
  status: "pending" | "running" | "done" | "error";
};

export function ProgressDialog({
  open,
  title,
  steps,
  generatedCount = 0,
  totalCount = 1,
  error,
  onCancel,
}: {
  open: boolean;
  title: string;
  steps: ProgressStep[];
  generatedCount?: number;
  totalCount?: number;
  error?: string | null;
  onCancel?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open]);

  if (!open) return null;

  const allDone = steps.every((s) => s.status === "done" || s.status === "error");
  const hasError = error || steps.some((s) => s.status === "error");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="glass-strong w-[400px] max-w-[90vw] p-6">
        <h2 className="editorial-title text-lg font-semibold mb-4">{title}</h2>

        {/* 图片生成进度 */}
        {totalCount > 1 && (
          <div className="mb-5">
            <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-2">
              <span>配图进度</span>
              <span>
                {generatedCount} / {totalCount}
              </span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.round((generatedCount / totalCount) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* 步骤列表 */}
        <ul className="space-y-3 mb-1">
          {steps.map((step, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  step.status === "done"
                    ? "bg-[var(--success)] text-white"
                    : step.status === "error"
                      ? "bg-[var(--danger)] text-white"
                      : step.status === "running"
                        ? "bg-[var(--accent)] text-white animate-pulse"
                        : "bg-[rgba(0,0,0,0.04)] text-[var(--muted)]"
                }`}
              >
                {step.status === "done" ? "✓" : step.status === "error" ? "✕" : i + 1}
              </span>
              <span
                className={
                  step.status === "done"
                    ? "text-[var(--foreground)]"
                    : step.status === "running"
                      ? "text-[var(--accent)]"
                      : step.status === "error"
                        ? "text-[var(--danger)]"
                        : "text-[var(--muted)]"
                }
              >
                {step.label}
              </span>
            </li>
          ))}
        </ul>

        {/* 状态信息 */}
        {hasError ? (
          <p className="mt-4 text-sm text-[var(--danger)]">{error || "操作失败"}</p>
        ) : allDone ? (
          <p className="mt-4 text-xs text-[var(--success)]">
            全部完成 · 耗时 {elapsed} 秒
          </p>
        ) : (
          <p className="mt-4 text-xs text-[var(--muted)]">
            已进行 {elapsed} 秒
            {onCancel && (
              <button onClick={onCancel} className="ml-3 text-[var(--accent)] hover:underline">
                取消
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
