"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, Loader2, X } from "lucide-react";
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

function taskArticleLabel(task: ArticleBackgroundTask) {
  return task.articleLabel?.trim() || "未命名文章";
}

export function BackgroundTaskFloat() {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { tasks, syncTasks } = useArticleBackgroundTasks();
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<ArticleBackgroundTask | null>(null);

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

  useEffect(() => {
    if (visibleTasks.length <= 1) setPanelOpen(false);
  }, [visibleTasks.length]);

  useEffect(() => {
    if (!panelOpen || pendingCancel) return;

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
  }, [panelOpen, pendingCancel]);

  const primaryTask = visibleTasks[0];
  const hasMultiple = visibleTasks.length > 1;

  function goToTask(task: ArticleBackgroundTask) {
    setPanelOpen(false);
    router.push(articlePath(task.articleId));
  }

  function handleFloatClick() {
    if (!primaryTask) return;
    if (hasMultiple) {
      setPanelOpen((open) => !open);
      return;
    }
    goToTask(primaryTask);
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

      {!primaryTask ? null : (
        <div ref={wrapRef} className="background-task-float-wrap">
          {panelOpen && hasMultiple ? (
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

          <div className="background-task-float">
            <button
              type="button"
              className="background-task-float-main"
              aria-label={
                hasMultiple
                  ? `查看 ${visibleTasks.length} 个进行中的任务`
                  : `查看进行中的任务：${primaryTask.label}`
              }
              aria-expanded={hasMultiple ? panelOpen : undefined}
              onClick={handleFloatClick}
            >
              <span className="background-task-float-spinner" aria-hidden="true">
                <Loader2 size={18} strokeWidth={2.2} />
              </span>
              <span className="background-task-float-text">
                <span className="background-task-float-label">
                  {hasMultiple ? `${visibleTasks.length} 个任务进行中` : primaryTask.label}
                </span>
                <span className="background-task-float-hint">
                  {hasMultiple ? (panelOpen ? "选择要查看的任务" : "点击选择任务") : "点击查看进度"}
                </span>
              </span>
              {hasMultiple ? (
                <span className="background-task-float-count" aria-hidden="true">
                  {visibleTasks.length}
                </span>
              ) : null}
            </button>
            {!hasMultiple ? (
              <button
                type="button"
                className="background-task-float-cancel"
                aria-label={`取消 ${primaryTask.label}`}
                onClick={() => handleCancelTask(primaryTask)}
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
