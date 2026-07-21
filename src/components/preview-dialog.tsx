"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import ArticleHtmlContent from "@/components/article-html-content";
import { normalizeCalloutBlocks, wrapSummarySection } from "@/lib/wechat-style";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  summary?: string | null;
  content?: string | null;
  coverImageUrl?: string | null;
  topic: string;
  targetWords?: number | null;
};

type Mode = "phone" | "desktop";

function useIsMobilePreview() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

function plainTextLength(html: string) {
  if (typeof window === "undefined") return html.length;
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\s+/g, "").length;
}

function PreviewArticleBody({
  title,
  summary,
  displayContent,
  coverImageUrl,
}: {
  title: string;
  summary?: string | null;
  displayContent: string;
  coverImageUrl?: string | null;
}) {
  return (
    <>
      {coverImageUrl ? <img src={coverImageUrl} alt="cover" className="mp-cover" /> : null}
      <h1>{title}</h1>
      <div className="mp-meta">{summary ? summary : "（未填写摘要）"}</div>
      <ArticleHtmlContent html={`<article>${displayContent}</article>`} />
      <div className="mp-preview-end">— 全文完 —</div>
    </>
  );
}

export default function PreviewDialog({
  open,
  onClose,
  title,
  summary,
  content,
  coverImageUrl,
  topic,
  targetWords,
}: Props) {
  const [mode, setMode] = useState<Mode>("phone");
  const isMobile = useIsMobilePreview();

  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  if (!open) return null;

  const safeContent = content && content.trim().length > 0
    ? content
    : `<p>（尚无正文）请先生成或粘贴内容，再回到这里预览。</p>`;

  const displayContent = normalizeCalloutBlocks(wrapSummarySection(safeContent));
  const safeTitle = title || topic || "未命名标题";
  const charCount = plainTextLength(safeContent);
  const ratio = targetWords ? Math.min(1, charCount / targetWords) : 1;

  if (isMobile) {
    return (
      <div className="preview-mobile-overlay" role="dialog" aria-modal="true" aria-label="文章预览">
        <header className="preview-mobile-header">
          <div className="preview-mobile-header-main">
            <p className="preview-mobile-eyebrow">公众号预览</p>
            <div className="preview-mobile-stats">
              <span className="badge badge-accent">{charCount} 字</span>
              {targetWords ? (
                <span
                  className={
                    ratio >= 0.9
                      ? "badge badge-success"
                      : ratio >= 0.6
                        ? "badge badge-warning"
                        : "badge badge-danger"
                  }
                >
                  {Math.round(ratio * 100)}%
                </span>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="preview-mobile-close" aria-label="关闭预览">
            <X size={20} />
          </button>
        </header>

        <div className="preview-mobile-scroll mp-preview">
          <PreviewArticleBody
            title={safeTitle}
            summary={summary}
            displayContent={displayContent}
            coverImageUrl={coverImageUrl}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="preview-desktop-overlay"
      onClick={onClose}
    >
      <div
        className="preview-desktop-panel glass-strong"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="preview-desktop-toolbar">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="editorial-title text-lg font-semibold text-[var(--foreground)]">预览</h3>
            <span className="badge badge-accent">{charCount} 字</span>
            {targetWords ? (
              <span
                className={
                  ratio >= 0.9
                    ? "badge badge-success"
                    : ratio >= 0.6
                      ? "badge badge-warning"
                      : "badge badge-danger"
                }
              >
                {Math.round(ratio * 100)}% / 目标 {targetWords} 字
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <div className="preview-mode-switch">
              <button
                type="button"
                onClick={() => setMode("phone")}
                className={mode === "phone" ? "preview-mode-btn-active" : "preview-mode-btn"}
              >
                手机
              </button>
              <button
                type="button"
                onClick={() => setMode("desktop")}
                className={mode === "desktop" ? "preview-mode-btn-active" : "preview-mode-btn"}
              >
                电脑
              </button>
            </div>
            <button type="button" onClick={onClose} className="btn-secondary text-sm py-1.5 px-3">
              关闭
            </button>
          </div>
        </div>

        <div className="preview-desktop-body">
          {mode === "phone" ? (
            <div className="preview-phone-frame">
              <div className="preview-phone-status">
                <span>9:41</span>
                <span className="font-medium">公众号预览</span>
                <span>•••</span>
              </div>
              <div className="preview-phone-scroll mp-preview">
                <PreviewArticleBody
                  title={safeTitle}
                  summary={summary}
                  displayContent={displayContent}
                  coverImageUrl={coverImageUrl}
                />
              </div>
            </div>
          ) : (
            <div className="preview-desktop-article">
              <div className="preview-desktop-article-label">模拟公众号文章页（桌面宽度）</div>
              <div className="mp-preview px-8 py-6">
                <PreviewArticleBody
                  title={safeTitle}
                  summary={summary}
                  displayContent={displayContent}
                  coverImageUrl={coverImageUrl}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
