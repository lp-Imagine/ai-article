"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listArticleBackgroundTasks,
  subscribeArticleBackgroundTasks,
  syncActiveJobsFromServer,
  type ArticleBackgroundTask,
} from "@/lib/article-task-tracker";

export function listVisibleArticleBackgroundTasks(pathname: string): ArticleBackgroundTask[] {
  return listArticleBackgroundTasks().filter(
    (task) => pathname !== `/articles/${task.articleId}`,
  );
}

export function useArticleBackgroundTasks() {
  const [tasks, setTasks] = useState<ArticleBackgroundTask[]>(() => listArticleBackgroundTasks());

  const syncTasks = useCallback(() => {
    setTasks(listArticleBackgroundTasks());
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeArticleBackgroundTasks(() => {
      setTasks(listArticleBackgroundTasks());
    });
    void syncActiveJobsFromServer().then(() => {
      setTasks(listArticleBackgroundTasks());
    });
    return unsubscribe;
  }, []);

  const runningTaskIds = new Set(tasks.map((task) => task.articleId));

  return { tasks, runningTaskIds, syncTasks };
}
