"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";

type Props = {
  page: number;
  total: number;
  pageSize: number;
  loading?: boolean;
  loadingMore?: boolean;
  onPageChange: (page: number) => void;
  onLoadMore: () => void;
  className?: string;
};

function pageWindow(current: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const start = Math.max(1, Math.min(current - 2, totalPages - 4));
  return Array.from({ length: 5 }, (_, i) => start + i);
}

export function ListPagination({
  page,
  total,
  pageSize,
  loading = false,
  loadingMore = false,
  onPageChange,
  onLoadMore,
  className,
}: Props) {
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasMore = page * pageSize < total;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = pageWindow(page, totalPages);

  return (
    <div className={clsx("list-pagination", className)}>
      <div className="list-pager">
        <p className="list-pager-meta">
          第 {from}–{to} 条，共 {total} 条
        </p>
        <div className="list-pager-controls">
          <button
            type="button"
            className="list-pager-btn"
            disabled={loading || page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="上一页"
          >
            <ChevronLeft size={16} />
          </button>
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              className={clsx("list-pager-btn list-pager-num", p === page && "list-pager-num-active")}
              disabled={loading || p === page}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="list-pager-btn"
            disabled={loading || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="下一页"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {hasMore ? (
        <div className="list-load-more">
          <button
            type="button"
            className="list-load-more-btn"
            disabled={loadingMore || loading}
            onClick={onLoadMore}
          >
            {loadingMore ? "加载中…" : `加载更多（已显示 ${Math.min(page * pageSize, total)} / ${total}）`}
          </button>
        </div>
      ) : total > pageSize ? (
        <p className="list-load-more-end">已加载全部 {total} 条</p>
      ) : null}
    </div>
  );
}
