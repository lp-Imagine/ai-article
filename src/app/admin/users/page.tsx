"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { PageHeader, SectionCard } from "@/components/app-shell";
import { ListPagination } from "@/components/list-pagination";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DEFAULT_PAGE_SIZE, type PaginatedData } from "@/lib/pagination";

type AdminUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: "USER" | "SUPER_ADMIN";
  disabled: boolean;
  createdAt: string;
  articleCount: number;
};

export default function AdminUsersPage() {
  const toast = useToast();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const pageRef = useRef(1);
  const totalRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [manageUser, setManageUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (targetPage: number, mode: "replace" | "append") => {
      if (mode === "append") setLoadingMore(true);
      else setLoading(true);

      try {
        const res = await fetch(`/api/admin/users?page=${targetPage}&limit=${pageSize}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (res.status === 403 || res.status === 401) {
          setForbidden(true);
          return;
        }
        if (json.code !== 0 || !json.data) {
          throw new Error(json.message || "加载失败");
        }
        const data = json.data as PaginatedData<AdminUser>;
        setTotal(data.total);
        totalRef.current = data.total;
        setPage(data.page);
        pageRef.current = data.page;
        setUsers((prev) => (mode === "append" ? [...prev, ...data.items] : data.items));
      } catch {
        toast.show({ message: "加载用户失败", variant: "error" });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [pageSize, toast],
  );

  useEffect(() => {
    void fetchPage(1, "replace");
  }, [fetchPage]);

  async function reloadAfterMutation(removed = 0) {
    const nextTotal = Math.max(0, totalRef.current - removed);
    const totalPages = nextTotal === 0 ? 0 : Math.ceil(nextTotal / pageSize);
    const nextPage = totalPages === 0 ? 1 : Math.min(pageRef.current, totalPages);
    await fetchPage(nextPage, "replace");
  }
  useEffect(() => {
    if (!manageUser) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManageUser(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [manageUser]);

  async function patchUser(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) {
        throw new Error(json.message || "操作失败");
      }
      toast.show({ message: "已更新", variant: "success" });
      setManageUser(null);
      await reloadAfterMutation(0);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "操作失败",
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json.code !== 0) {
        throw new Error(json.message || "删除失败");
      }
      toast.show({ message: "用户已删除", variant: "success" });
      setManageUser(null);
      await reloadAfterMutation(1);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "删除失败",
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget || newPassword.length < 6) return;
    await patchUser(resetTarget.id, { password: newPassword });
    setResetTarget(null);
    setNewPassword("");
  }

  function openReset(user: AdminUser) {
    setManageUser(null);
    setResetTarget(user);
    setNewPassword("");
  }

  function openDelete(user: AdminUser) {
    setManageUser(null);
    setPendingDelete(user);
  }

  if (forbidden) {
    return (
      <div className="page-stack">
        <PageHeader title="用户管理" description="仅超级管理员可访问此页面。" />
        <SectionCard title="无权限">
          <p className="text-sm text-[var(--muted)]">你的账号没有超级管理员权限。</p>
          <button type="button" className="btn-secondary mt-4" onClick={() => router.push("/")}>
            返回工作台
          </button>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin"
        title="用户管理"
        description="查看、禁用、重置密码或删除已注册用户。每个用户的文章与设置相互隔离。"
      />

      <SectionCard title={`全部用户${total > 0 ? ` · ${total}` : ""}`}>
        {loading && users.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">加载中…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">暂无用户</p>
        ) : (
          <>
          <div className="admin-user-list">
            {users.map((user) => {
              const display = user.displayName || user.username;
              const busy = busyId === user.id;
              return (
                <article key={user.id} className="admin-user-row">
                  <div className="admin-user-main">
                    <div className="admin-user-identity">
                      <div className="admin-user-avatar" aria-hidden>
                        {display.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="admin-user-text">
                        <p className="admin-user-display" title={display}>
                          {display}
                        </p>
                        <p className="admin-user-username">@{user.username}</p>
                      </div>
                      <button
                        type="button"
                        className="admin-user-manage-btn"
                        disabled={busy}
                        onClick={() => setManageUser(user)}
                      >
                        管理
                        <ChevronRight size={16} strokeWidth={2} />
                      </button>
                    </div>
                    <div className="admin-user-meta">
                      <span className={`badge ${user.role === "SUPER_ADMIN" ? "badge-accent" : "badge-muted"}`}>
                        {user.role === "SUPER_ADMIN" ? "超级管理员" : "普通用户"}
                      </span>
                      <span className={`badge ${user.disabled ? "badge-danger" : "badge-success"}`}>
                        {user.disabled ? "已禁用" : "正常"}
                      </span>
                      <span className="admin-user-stat">文章 {user.articleCount}</span>
                    </div>
                  </div>
                  <div className="admin-user-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() =>
                        patchUser(user.id, {
                          role: user.role === "SUPER_ADMIN" ? "USER" : "SUPER_ADMIN",
                        })
                      }
                    >
                      {user.role === "SUPER_ADMIN" ? "降为用户" : "设为超管"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => patchUser(user.id, { disabled: !user.disabled })}
                    >
                      {user.disabled ? "启用" : "禁用"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => openReset(user)}
                    >
                      重置密码
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={busy}
                      onClick={() => openDelete(user)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <ListPagination
            page={page}
            total={total}
            pageSize={pageSize}
            loading={loading}
            loadingMore={loadingMore}
            onPageChange={(next) => void fetchPage(next, "replace")}
            onLoadMore={() => void fetchPage(page + 1, "append")}
          />
          </>
        )}
      </SectionCard>

      {manageUser ? (
        <div
          className="admin-action-sheet-overlay"
          role="presentation"
          onClick={() => setManageUser(null)}
        >
          <div
            className="admin-action-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-action-sheet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-action-sheet-handle" aria-hidden />
            <div className="admin-action-sheet-head">
              <p className="admin-action-sheet-eyebrow">管理用户</p>
              <h2 id="admin-action-sheet-title" className="admin-action-sheet-title">
                {manageUser.displayName || manageUser.username}
              </h2>
              <p className="admin-action-sheet-sub">@{manageUser.username}</p>
            </div>
            <div className="admin-action-sheet-list">
              <button
                type="button"
                className="admin-action-sheet-item"
                disabled={busyId === manageUser.id}
                onClick={() =>
                  patchUser(manageUser.id, {
                    role: manageUser.role === "SUPER_ADMIN" ? "USER" : "SUPER_ADMIN",
                  })
                }
              >
                {manageUser.role === "SUPER_ADMIN" ? "降为普通用户" : "设为超级管理员"}
              </button>
              <button
                type="button"
                className="admin-action-sheet-item"
                disabled={busyId === manageUser.id}
                onClick={() => patchUser(manageUser.id, { disabled: !manageUser.disabled })}
              >
                {manageUser.disabled ? "启用账号" : "禁用账号"}
              </button>
              <button
                type="button"
                className="admin-action-sheet-item"
                disabled={busyId === manageUser.id}
                onClick={() => openReset(manageUser)}
              >
                重置密码
              </button>
              <button
                type="button"
                className="admin-action-sheet-item admin-action-sheet-item-danger"
                disabled={busyId === manageUser.id}
                onClick={() => openDelete(manageUser)}
              >
                删除用户
              </button>
            </div>
            <button
              type="button"
              className="admin-action-sheet-cancel"
              onClick={() => setManageUser(null)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除用户？"
        description={
          pendingDelete
            ? `将删除「${pendingDelete.username}」及其全部文章与配置，且不可恢复。`
            : undefined
        }
        confirmLabel="删除"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      {resetTarget ? (
        <div
          className="confirm-dialog-overlay"
          role="presentation"
          onClick={() => setResetTarget(null)}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={submitReset}>
              <div className="confirm-dialog-body">
                <p className="confirm-dialog-eyebrow">账号安全</p>
                <h2 id="reset-password-title" className="confirm-dialog-title">
                  重置密码
                </h2>
                <p className="confirm-dialog-desc">
                  为 <strong>@{resetTarget.username}</strong> 设置新密码，原密码将立即失效。
                </p>
                <label className="confirm-dialog-field">
                  <span className="field-label">新密码</span>
                  <input
                    type="password"
                    className="confirm-dialog-input"
                    placeholder="至少 6 位"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                    required
                    autoFocus
                    autoComplete="new-password"
                  />
                  <span className="confirm-dialog-hint">建议使用字母与数字组合，勿与常用密码相同。</span>
                </label>
              </div>
              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="btn-secondary confirm-dialog-btn"
                  onClick={() => setResetTarget(null)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="confirm-dialog-btn confirm-dialog-btn-danger"
                  disabled={newPassword.length < 6}
                >
                  确认重置
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
