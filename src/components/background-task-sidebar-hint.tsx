"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

  // 必须在 client mount 之后再渲染：
  // 1) SSR 拿不到客户端 article-task-tracker 的内存状态，输出的 HTML 可能是空的
  // 2) client hydrate 时 React 比对 server HTML 与初始 JSX，看到 SSR 有 / 没有但 client 没有 / 有 → hydration mismatch
  // 等到 useEffect 触发后再 setMounted=true，再渲染真实内容，
  // server 与 client 第一次渲染都得到 null，避免整页被 React 重新生成。
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

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
