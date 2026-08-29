"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BLOG_SECTION_NAV_ORDER,
  SECTION_GROUPS,
  SECTION_LABELS,
  formatBlogGroupPath,
  inferBlogGroup,
  inferBlogPlacement,
  type BlogSection,
} from "@/lib/blog-sync-constants";

export type PushChannel = "wechat" | "blog";

export type PushConfirmPayload = {
  channels: PushChannel[];
  blog?: {
    section: string;
    group: string;
    tags: string[];
    draft: boolean;
  };
};

type CatalogSection = {
  id: string;
  label: string;
  groups: Array<{ id: string; label: string }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: PushConfirmPayload) => void;
  busy: boolean;
  title: string;
  summary?: string | null;
  coverImageUrl?: string | null;
  wordCount: number;
  targetWords?: number | null;
  blogSyncConfigured?: boolean;
  defaultTags?: string;
};

function parseTags(raw: string): string[] {
  return raw
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function localCatalogSections(): CatalogSection[] {
  return BLOG_SECTION_NAV_ORDER.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    groups: SECTION_GROUPS[id] ?? [{ id: "misc", label: "其它" }],
  }));
}

export default function PushDialog({
  open,
  onClose,
  onConfirm,
  busy,
  title,
  summary,
  coverImageUrl,
  wordCount,
  targetWords,
  blogSyncConfigured = false,
  defaultTags = "",
}: Props) {
  const [pushWechat, setPushWechat] = useState(true);
  const [pushBlog, setPushBlog] = useState(false);
  const [section, setSection] = useState<string>("web");
  const [pickedGroup, setGroup] = useState("javascript");
  const [tagsInput, setTagsInput] = useState(defaultTags);
  const [draft, setDraft] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [catalogSections, setCatalogSections] = useState<CatalogSection[]>(localCatalogSections);
  const [catalogSource, setCatalogSource] = useState<"github" | "local">("local");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !blogSyncConfigured) return;
    let cancelled = false;
    void fetch("/api/blog/catalog", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || json?.code !== 0 || !json?.data?.sections?.length) return;
        setCatalogSections(json.data.sections as CatalogSection[]);
        setCatalogSource(json.data.source === "github" ? "github" : "local");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, blogSyncConfigured]);

  const sectionMeta = catalogSections.find((s) => s.id === section) ?? catalogSections[0];
  const groups = sectionMeta?.groups ?? [{ id: "misc", label: "其它" }];
  const group = groups.some((g) => g.id === pickedGroup)
    ? pickedGroup
    : (groups[0]?.id ?? "misc");

  const hintBlob = useMemo(
    () => [title, summary ?? "", tagsInput || defaultTags],
    [title, summary, tagsInput, defaultTags],
  );

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open) return;
    setPushWechat(true);
    setPushBlog(blogSyncConfigured);
    setTagsInput(defaultTags);
    setDraft(false);
    setManualOverride(false);
    const placed = inferBlogPlacement([title, summary ?? "", defaultTags]);
    setSection(placed.section);
    setGroup(placed.group);
  }, [open, blogSyncConfigured, defaultTags, title, summary]);

  useEffect(() => {
    if (!open || manualOverride || !pushBlog) return;
    const placed = inferBlogPlacement(hintBlob);
    const known = catalogSections.some((s) => s.id === placed.section);
    setSection(known ? placed.section : (catalogSections[0]?.id ?? "web"));
    setGroup(placed.group);
  }, [open, hintBlob, manualOverride, pushBlog, catalogSections]);

  const previewTags = useMemo(() => parseTags(tagsInput), [tagsInput]);
  const sectionLabel = sectionMeta?.label ?? section;
  const groupLabel = groups.find((g) => g.id === group)?.label ?? group;
  const blogPath = formatBlogGroupPath(section as BlogSection, group);
  const canConfirm = pushWechat || (pushBlog && blogSyncConfigured);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="push-dialog-overlay mobile-dialog-sheet"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-dialog-title"
    >
      <div className="push-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="push-dialog-body">
          <h2
            id="push-dialog-title"
            className="editorial-title text-xl font-semibold text-[var(--foreground)]"
          >
            推送
          </h2>

          {coverImageUrl ? (
            <div>
              <Label>封面图</Label>
              <img
                src={coverImageUrl}
                alt="封面"
                className="mt-2 h-40 w-full rounded-lg border border-[var(--line)] object-cover"
              />
            </div>
          ) : pushWechat ? (
            <div className="rounded-lg border border-dashed border-[var(--warning)] bg-[var(--warning-soft)] p-4 text-sm text-[#b45309]">
              暂未生成封面图，推送微信时系统将自动生成一张。
            </div>
          ) : null}

          <div>
            <Label>标题</Label>
            <p className="mt-1.5 text-base font-semibold leading-snug text-[var(--foreground)]">
              {title}
            </p>
          </div>

          <div>
            <Label>摘要</Label>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              {summary || "（未填写摘要，将截取正文前段）"}
            </p>
          </div>

          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            <span>{wordCount} 字</span>
            {targetWords ? (
              <span className="badge badge-accent">目标 {targetWords} 字</span>
            ) : null}
          </div>

          <div>
            <Label>推送到</Label>
            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--foreground)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={pushWechat}
                  onChange={(e) => setPushWechat(e.target.checked)}
                  disabled={busy}
                />
                <span>
                  <span className="font-medium">微信公众号草稿箱</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">
                    写入草稿，不会立即发布
                  </span>
                </span>
              </label>

              {blogSyncConfigured ? (
                <label className="flex items-start gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={pushBlog}
                    onChange={(e) => setPushBlog(e.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    <span className="font-medium">博客</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      写入站点栏目，并触发 Pages 部署
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
          </div>

          {blogSyncConfigured && pushBlog ? (
            <div className="push-blog-panel">
              <div className="push-blog-preview-head">
                <div className="push-blog-preview-main">
                  <p className="push-blog-preview-kicker">站点归档位置</p>
                  <p className="push-blog-preview-title">
                    {sectionLabel}
                    <span className="push-blog-preview-sep">·</span>
                    {groupLabel}
                  </p>
                  <p className="push-blog-preview-path" title={blogPath}>
                    website{blogPath}
                  </p>
                  <p className="push-blog-preview-hint">
                    {manualOverride
                      ? "已手动指定栏目与侧栏分组"
                      : catalogSource === "github"
                        ? "已根据标题自动匹配，栏目结构来自博客仓库"
                        : "已根据标题、摘要、标签自动匹配站点结构"}
                  </p>
                </div>
                <button
                  type="button"
                  className="push-blog-adjust-btn"
                  onClick={() => setManualOverride((v) => !v)}
                  disabled={busy}
                >
                  {manualOverride ? "收起" : "调整"}
                </button>
              </div>

              {manualOverride ? (
                <div className="push-blog-fields">
                  <div className="push-blog-field">
                    <label className="push-blog-field-label" htmlFor="push-blog-section">
                      站点栏目
                    </label>
                    <select
                      id="push-blog-section"
                      className="push-blog-field-control"
                      value={section}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSection(next);
                        const nextGroups =
                          catalogSections.find((s) => s.id === next)?.groups ?? [];
                        const inferred = (BLOG_SECTION_NAV_ORDER as readonly string[]).includes(next)
                          ? inferBlogGroup(next as BlogSection, [
                              title,
                              summary ?? "",
                              tagsInput,
                            ])
                          : nextGroups[0]?.id;
                        setGroup(
                          nextGroups.some((g) => g.id === inferred)
                            ? (inferred as string)
                            : (nextGroups[0]?.id ?? "misc"),
                        );
                      }}
                      disabled={busy}
                    >
                      {catalogSections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="push-blog-field">
                    <label className="push-blog-field-label" htmlFor="push-blog-group">
                      侧栏分组
                    </label>
                    <select
                      id="push-blog-group"
                      className="push-blog-field-control"
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                      disabled={busy}
                    >
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}

              <div className="push-blog-field push-blog-field-full">
                <label className="push-blog-field-label" htmlFor="push-blog-tags">
                  标签
                </label>
                <input
                  id="push-blog-tags"
                  className="push-blog-field-control"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="JavaScript, Vue"
                  disabled={busy}
                />
                <p className="push-blog-field-hint">逗号分隔，写入 frontmatter tags</p>
              </div>

              <label className="push-blog-draft">
                <input
                  type="checkbox"
                  checked={draft}
                  onChange={(e) => setDraft(e.target.checked)}
                  disabled={busy}
                />
                <span>以草稿写入（draft: true）</span>
              </label>
            </div>
          ) : null}

          {pushWechat ? (
            <div className="rounded-lg border border-[rgba(0,113,227,0.15)] bg-[var(--accent-soft)] p-3 text-xs text-[var(--accent)]">
              微信侧写入草稿箱，不会立即群发。请先在「设置 → 微信公众号」配置 App ID / Secret。
            </div>
          ) : null}
        </div>

        <div className="push-dialog-actions">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex-1 py-2.5 text-sm"
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canConfirm) return;
              const channels: PushChannel[] = [];
              if (pushWechat) channels.push("wechat");
              if (pushBlog && blogSyncConfigured) channels.push("blog");
              onConfirm({
                channels,
                blog:
                  channels.includes("blog")
                    ? {
                        section,
                        group,
                        tags: previewTags,
                        draft,
                      }
                    : undefined,
              });
            }}
            className="btn-primary flex-1 py-2.5 text-sm"
            disabled={busy || !canConfirm}
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                推送中...
              </span>
            ) : (
              confirmLabel(pushWechat, pushBlog && blogSyncConfigured)
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function confirmLabel(wechat: boolean, blog: boolean): string {
  if (wechat && blog) return "确认全部推送";
  if (blog) return "确认同步博客";
  return "确认推送微信";
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs uppercase tracking-widest text-[var(--muted)]">
      {children}
    </span>
  );
}
