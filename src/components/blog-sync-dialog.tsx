"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BLOG_SECTIONS,
  SECTION_GROUPS,
  inferBlogGroup,
  type BlogSection,
} from "@/lib/blog-sync-constants";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    section: BlogSection;
    group: string;
    tags: string[];
    draft: boolean;
  }) => void;
  busy: boolean;
  title: string;
  summary?: string | null;
  coverImageUrl?: string | null;
  defaultTags?: string;
};

const SECTION_LABELS: Record<BlogSection, string> = {
  web: "JS & 框架",
  ui: "样式",
  tech: "工具备忘",
  computer: "浏览器",
  misc: "杂项",
};

function parseTags(raw: string): string[] {
  return raw
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export default function BlogSyncDialog({
  open,
  onClose,
  onConfirm,
  busy,
  title,
  summary,
  coverImageUrl,
  defaultTags = "",
}: Props) {
  const [section, setSection] = useState<BlogSection>("web");
  const [group, setGroup] = useState("javascript");
  const [tagsInput, setTagsInput] = useState(defaultTags);
  const [draft, setDraft] = useState(false);

  const groups = SECTION_GROUPS[section] ?? SECTION_GROUPS.misc;

  useEffect(() => {
    if (!open) return;
    setTagsInput(defaultTags);
    setDraft(false);
    const inferred = inferBlogGroup("web", [title, defaultTags]);
    setSection("web");
    setGroup(inferred);
  }, [open, defaultTags, title]);

  useEffect(() => {
    const allowed = SECTION_GROUPS[section] ?? SECTION_GROUPS.misc;
    if (!allowed.some((g) => g.id === group)) {
      setGroup(allowed[0]?.id ?? "misc");
    }
  }, [section, group]);

  const previewTags = useMemo(() => parseTags(tagsInput), [tagsInput]);

  if (!open) return null;

  return (
    <div
      className="push-dialog-overlay mobile-dialog-sheet"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="blog-sync-dialog-title"
    >
      <div className="push-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="push-dialog-body">
          <h2
            id="blog-sync-dialog-title"
            className="editorial-title text-xl font-semibold text-[var(--foreground)]"
          >
            同步到博客
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
              {summary || "（未填写摘要）"}
            </p>
          </div>

          <div>
            <Label>顶栏栏目</Label>
            <select
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
              value={section}
              onChange={(e) => {
                const next = e.target.value as BlogSection;
                setSection(next);
                const inferred = inferBlogGroup(next, [title, tagsInput]);
                setGroup(inferred);
              }}
              disabled={busy}
            >
              {BLOG_SECTIONS.filter((k) => k !== "misc").map((key) => (
                <option key={key} value={key}>
                  {SECTION_LABELS[key]}
                </option>
              ))}
              <option value="misc">{SECTION_LABELS.misc}</option>
            </select>
          </div>

          <div>
            <Label>侧栏分类</Label>
            <select
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
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

          <div>
            <Label>标签（逗号分隔，可选）</Label>
            <input
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="JavaScript, Vue"
              disabled={busy}
            />
            {previewTags.length > 0 ? (
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                将写入：{previewTags.join(" · ")}
              </p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
              disabled={busy}
            />
            以草稿写入（draft: true，不进首页/侧栏）
          </label>

          <div className="rounded-lg border border-[rgba(0,113,227,0.15)] bg-[var(--accent-soft)] p-3 text-xs text-[var(--accent)]">
            将写入 vuepressblog 的「{SECTION_LABELS[section]} / {groups.find((g) => g.id === group)?.label}」，并触发自动部署。
          </div>
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
            onClick={() =>
              onConfirm({
                section,
                group,
                tags: previewTags,
                draft,
              })
            }
            className="btn-primary flex-1 py-2.5 text-sm"
            disabled={busy}
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                同步中...
              </span>
            ) : (
              "确认同步"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs uppercase tracking-widest text-[var(--muted)]">
      {children}
    </span>
  );
}
