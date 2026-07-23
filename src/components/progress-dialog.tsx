"use client";

import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

export type ProgressStep = {
  label: string;
  status: "pending" | "running" | "done" | "error";
};

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins} 分 ${secs} 秒` : `${mins} 分钟`;
}

function elapsedSecondsFrom(startedAt?: number | null) {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

export function ProgressDialog({
  open,
  title,
  steps,
  generatedCount = 0,
  totalCount = 1,
  error,
  startedAt,
  onCancel,
}: {
  open: boolean;
  title: string;
  steps: ProgressStep[];
  generatedCount?: number;
  totalCount?: number;
  error?: string | null;
  /** 任务真实开始时间（ms），离开页面再返回时用于续计时 */
  startedAt?: number | null;
  onCancel?: () => void;
}) {
  const [elapsed, setElapsed] = useState(() => elapsedSecondsFrom(startedAt));

  const allDone = steps.every((s) => s.status === "done" || s.status === "error");
  const hasError = Boolean(error || steps.some((s) => s.status === "error"));

  useEffect(() => {
    if (!open) return;

    const anchor = startedAt ?? Date.now();
    setElapsed(elapsedSecondsFrom(anchor));
    if (allDone || hasError) return;

    const timer = setInterval(() => {
      setElapsed(elapsedSecondsFrom(anchor));
    }, 1000);

    return () => clearInterval(timer);
  }, [open, startedAt, allDone, hasError]);

  if (!open) return null;

  const showImageProgress = totalCount > 1;
  const progressRatio = totalCount > 0 ? generatedCount / totalCount : 0;
  const progressPercent = Math.round(progressRatio * 100);
  const runningStep = steps.find((s) => s.status === "running");

  return (
    <div
      className="progress-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-dialog-title"
    >
      <div className="progress-dialog">
        <header className="progress-dialog-header">
          <div className="progress-dialog-header-main">
            <p className="progress-dialog-eyebrow">AI 任务</p>
            <h2 id="progress-dialog-title" className="progress-dialog-title editorial-title">
              {title}
            </h2>
          </div>
          <span
            className={`progress-dialog-badge ${
              hasError
                ? "progress-dialog-badge-error"
                : allDone
                  ? "progress-dialog-badge-done"
                  : "progress-dialog-badge-running"
            }`}
          >
            {hasError ? "失败" : allDone ? "已完成" : "进行中"}
          </span>
        </header>

        {showImageProgress && (
          <section className="progress-dialog-metrics" aria-label="配图进度">
            <div className="progress-dialog-metrics-row">
              <span className="progress-dialog-metrics-label">配图进度</span>
              <span className="progress-dialog-metrics-value">
                {generatedCount} / {totalCount}
                <span className="progress-dialog-metrics-percent">{progressPercent}%</span>
              </span>
            </div>
            <div className="progress-dialog-track" aria-hidden="true">
              <div
                className="progress-dialog-track-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </section>
        )}

        <section className="progress-dialog-stepper" aria-label="任务步骤">
          <ol className="progress-stepper-list">
            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              return (
                <li
                  key={i}
                  className={`progress-stepper-item progress-stepper-item-${step.status}`}
                >
                  <div className="progress-stepper-rail">
                    <span className={`progress-stepper-marker progress-stepper-marker-${step.status}`}>
                      {step.status === "done" ? (
                        <Check size={12} strokeWidth={3} />
                      ) : step.status === "error" ? (
                        <X size={12} strokeWidth={3} />
                      ) : step.status === "running" ? (
                        <Loader2 size={12} className="progress-stepper-spinner" />
                      ) : (
                        <span>{i + 1}</span>
                      )}
                    </span>
                    {!isLast ? <span className="progress-stepper-line" aria-hidden="true" /> : null}
                  </div>
                  <div className="progress-stepper-body">
                    <p className="progress-stepper-label">{step.label}</p>
                    {step.status === "running" && runningStep === step ? (
                      <p className="progress-stepper-hint">正在处理，请稍候…</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <footer className="progress-dialog-footer">
          {!allDone && !hasError && onCancel ? (
            <button type="button" onClick={onCancel} className="progress-dialog-cancel">
              取消任务
            </button>
          ) : null}

          {hasError ? (
            <p className="progress-dialog-error">{error || "操作失败，请稍后重试"}</p>
          ) : allDone ? (
            <p className="progress-dialog-done">全部完成 · 耗时 {formatElapsed(elapsed)}</p>
          ) : (
            <div className="progress-dialog-footer-meta">
              <p className="progress-dialog-elapsed">已进行 {formatElapsed(elapsed)}</p>
              <p className="progress-dialog-hint">可切换页面，任务会在后台继续；返回本文可查看进度</p>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
