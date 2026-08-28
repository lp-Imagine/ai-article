"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelArticleBackgroundTask,
  pollArticleBackgroundTasks,
  type ArticleBackgroundTask,
} from "@/lib/article-task-tracker";
import {
  listVisibleArticleBackgroundTasks,
  useArticleBackgroundTasks,
} from "@/hooks/use-article-background-tasks";
import { useEdgeSnappedFloat } from "@/hooks/use-edge-snapped-float";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

function articlePath(articleId: string) {
  return `/articles/${articleId}`;
}

function articleIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = pathname.match(/^\/articles\/([^/]+)/);
  return match?.[1] ?? null;
}

function taskArticleLabel(task: ArticleBackgroundTask | null | undefined) {
  return task?.articleLabel?.trim() || "未命名文章";
}

function shortTaskLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return "处理";
  if (/大纲/.test(trimmed)) return "大纲";
  if (/正文/.test(trimmed)) return "正文";
  if (/推送/.test(trimmed)) return "推送";
  if (/润色/.test(trimmed)) return "润色";
  if (/扩写/.test(trimmed)) return "扩写";
  const core = trimmed.replace(/^(重新)?生成/, "").trim();
  return core.slice(0, 3) || "任务";
}

export function BackgroundTaskFloat() {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLDivElement>(null);
  const { tasks, syncTasks } = useArticleBackgroundTasks();
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<ArticleBackgroundTask | null>(null);
  const [mounted, setMounted] = useState(false);
  const {
    placement,
    positionStyle,
    dragging,
    onDragPointerDown,
    consumeDragClick,
    realignPlacement,
  } = useEdgeSnappedFloat(wrapRef, unitRef);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (tasks.length === 0) return;

    let stopped = false;
    const viewingArticleId = articleIdFromPath(pathname);

    const poll = async () => {
      if (stopped) return;
      await pollArticleBackgroundTasks({
        // 当前文章详情页自己负责刷新，避免浮标先清掉任务导致页面不更新
        ignoreArticleIds: viewingArticleId ? [viewingArticleId] : [],
        onComplete: (task) => {
          toast.show({
            title: "后台任务已完成",
            message: `${task.label}已完成`,
            variant: "success",
          });
        },
        onFailed: (task, message) => {
          toast.show({
            title: "后台任务失败",
            message: `${task.label}：${message}`,
            variant: "error",
          });
        },
      });
      if (!stopped) syncTasks();
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 2000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tasks.length, syncTasks, toast, pathname]);

  const visibleTasks = useMemo(
    () => listVisibleArticleBackgroundTasks(pathname),
    [pathname, tasks],
  );

  const primaryTask = visibleTasks[0];
  const hasMultiple = visibleTasks.length > 1;
  const panelVisible = panelOpen && hasMultiple;
  const displayLabel = !primaryTask
    ? "任务进行中"
    : hasMultiple
      ? `${visibleTasks.length} 个任务进行中`
      : `${shortTaskLabel(primaryTask.label)}中 · ${taskArticleLabel(primaryTask)}`;

  useEffect(() => {
    if (!primaryTask) return;
    const frame = window.requestAnimationFrame(() => {
      realignPlacement();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, primaryTask?.articleId, realignPlacement]);

  useEffect(() => {
    if (dragging && panelOpen) {
      setPanelOpen(false);
    }
  }, [dragging, panelOpen]);

  useEffect(() => {
    if (!panelVisible || pendingCancel) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      setPanelOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelVisible, pendingCancel]);

  function goToTask(task: ArticleBackgroundTask) {
    setPanelOpen(false);
    router.push(articlePath(task.articleId));
  }

  function handleFloatClick(event?: React.MouseEvent) {
    if (event) {
      const target = event.target as HTMLElement;
      if (target.closest(".background-task-float-cancel")) return;
    }
    if (consumeDragClick()) return;
    if (!primaryTask) return;
    if (hasMultiple) {
      setPanelOpen((open) => !open);
      return;
    }
    goToTask(primaryTask);
  }

  function handleDragPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".background-task-float-cancel")) return;
    onDragPointerDown(event);
  }

  function handleCancelClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!primaryTask) return;
    handleCancelTask(primaryTask);
  }

  function handleCancelTask(task: ArticleBackgroundTask) {
    setPendingCancel(task);
  }

  function confirmCancelTask() {
    if (!pendingCancel) return;

    cancelArticleBackgroundTask(pendingCancel.articleId);
    syncTasks();
    if (visibleTasks.length <= 1) setPanelOpen(false);
    setPendingCancel(null);
    toast.show({
      message: `已取消：${pendingCancel.label}`,
      variant: "info",
    });
  }

  return (
    <>
      <ConfirmDialog
        open={pendingCancel !== null}
        title={pendingCancel ? `取消「${pendingCancel.label}」？` : ""}
        description={pendingCancel ? taskArticleLabel(pendingCancel) : undefined}
        confirmLabel="确认取消"
        onConfirm={confirmCancelTask}
        onCancel={() => setPendingCancel(null)}
      />

      {mounted && primaryTask ? (
        <div
          ref={wrapRef}
          className="background-task-float-wrap"
          data-edge={placement?.edge ?? "right"}
          data-dragging={dragging ? "true" : undefined}
          data-shape="circle"
          style={positionStyle}
        >
          <div
            ref={unitRef}
            className="background-task-float-unit"
            onPointerDown={handleDragPointerDown}
            onClick={handleFloatClick}
          >
            <div className="background-task-float">
              <span className="background-task-float-breathe" aria-hidden="true" />
              <span className="background-task-float-breathe background-task-float-breathe-2" aria-hidden="true" />
              <span className="background-task-float-orbit" aria-hidden="true" />
              <div
                className="background-task-float-main"
                title={displayLabel}
                aria-label={
                  hasMultiple
                    ? `查看 ${visibleTasks.length} 个进行中的任务`
                    : `查看进行中的任务：${primaryTask.label}，${taskArticleLabel(primaryTask)}`
                }
                aria-expanded={hasMultiple ? panelVisible : undefined}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleFloatClick();
                  }
                }}
              >
                {hasMultiple ? (
                  <>
                    <span className="background-task-float-count">{visibleTasks.length}</span>
                    <span className="background-task-float-sub">任务</span>
                  </>
                ) : (
                  <>
                    <span className="background-task-float-type">
                      {shortTaskLabel(primaryTask.label)}
                    </span>
                    <span className="background-task-float-sub">进行中</span>
                  </>
                )}
              </div>
              {!hasMultiple ? (
                <button
                  type="button"
                  className="background-task-float-cancel"
                  aria-label={`取消 ${primaryTask.label}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={handleCancelClick}
                >
                  <X size={10} strokeWidth={2.8} />
                </button>
              ) : null}
            </div>
          </div>

          {panelVisible ? (
            <div className="background-task-float-panel" role="dialog" aria-label="进行中的任务">
              <div className="background-task-float-panel-head">
                <p className="background-task-float-panel-title">进行中的任务</p>
                <span className="background-task-float-panel-count">{visibleTasks.length}</span>
              </div>
              <ul className="background-task-float-list">
                {visibleTasks.map((task) => (
                  <li key={task.articleId} className="background-task-float-list-item">
                    <button
                      type="button"
                      className="background-task-float-item"
                      onClick={() => goToTask(task)}
                    >
                      <span className="background-task-float-item-main">
                        <span className="background-task-float-item-label">{task.label}</span>
                        <span className="background-task-float-item-article">
                          {taskArticleLabel(task)}
                        </span>
                      </span>
                      <ChevronRight size={16} className="background-task-float-item-arrow" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="background-task-float-item-cancel"
                      aria-label={`取消 ${task.label}`}
                      onClick={() => handleCancelTask(task)}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
