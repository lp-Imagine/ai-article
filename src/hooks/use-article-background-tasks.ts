"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listArticleBackgroundTasks,
  subscribeArticleBackgroundTasks,
  type ArticleBackgroundTask,
} from "@/lib/article-task-tracker";

export function listVisibleArticleBackgroundTasks(pathname: string): ArticleBackgroundTask[] {
  return listArticleBackgroundTasks().filter(
    (task) => pathname !== `/articles/${task.articleId}`,
  );
}

export function useArticleBackgroundTasks() {
  const [tasks, setTasks] = useState<ArticleBackgroundTask[]>([]);

  const syncTasks = useCallback(() => {
    setTasks(listArticleBackgroundTasks());
  }, []);

  useEffect(() => {
    syncTasks();
    return subscribeArticleBackgroundTasks(syncTasks);
  }, [syncTasks]);

  const runningTaskIds = new Set(tasks.map((task) => task.articleId));

  return { tasks, runningTaskIds, syncTasks };
}
