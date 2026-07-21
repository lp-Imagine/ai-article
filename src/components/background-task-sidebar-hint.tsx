"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { listVisibleArticleBackgroundTasks, useArticleBackgroundTasks } from "@/hooks/use-article-background-tasks";

function articlePath(articleId: string) {
  return `/articles/${articleId}`;
}

export function BackgroundTaskSidebarHint() {
  const pathname = usePathname();
  const { tasks } = useArticleBackgroundTasks();

  const visibleTasks = useMemo(
    () => listVisibleArticleBackgroundTasks(pathname),
    [pathname, tasks],
  );

  if (visibleTasks.length === 0) return null;

  const primaryTask = visibleTasks[0];
  const href = articlePath(primaryTask.articleId);

  return (
    <Link href={href} className="background-task-sidebar-hint">
      <span className="background-task-sidebar-hint-spinner" aria-hidden="true">
        <Loader2 size={14} strokeWidth={2.2} />
      </span>
      <span className="background-task-sidebar-hint-text">
        <span className="background-task-sidebar-hint-label">
          {visibleTasks.length > 1
            ? `${visibleTasks.length} 个任务进行中`
            : `${primaryTask.label}中…`}
        </span>
        <span className="background-task-sidebar-hint-sub">
          {visibleTasks.length > 1
            ? primaryTask.articleLabel ?? "点击查看"
            : primaryTask.articleLabel ?? "返回查看进度"}
        </span>
      </span>
    </Link>
  );
}
