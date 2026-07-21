"use client";

import { useCallback, useEffect, useRef } from "react";
import { decodeCodeSource, highlightedCodeToPlainText } from "@/lib/code-highlight";
import { useToast } from "@/components/toast";

type Props = {
  html: string;
  className?: string;
};

function extractCodeFromBlock(block: HTMLElement): string {
  const encoded = block.getAttribute("data-mp-code-source");
  if (encoded) {
    const decoded = decodeCodeSource(encoded);
    if (decoded) return decoded;
  }

  const body = block.querySelector('[data-mp-cb-body="1"]');
  if (!body) return "";
  return highlightedCodeToPlainText(body.innerHTML);
}

export default function ArticleHtmlContent({ html, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const attachCopyButtons = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;

    root.querySelectorAll('[data-mp-cb="1"]').forEach((node) => {
      const block = node as HTMLElement;
      if (block.dataset.mpCopyBound === "1") return;
      block.dataset.mpCopyBound = "1";

      const langBar = block.querySelector('[data-mp-cb-lang="1"]') as HTMLElement | null;
      if (!langBar) return;

      langBar.classList.add("mp-code-lang-bar");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mp-code-copy-btn";
      btn.setAttribute("aria-label", "复制代码");
      btn.textContent = "复制";

      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const code = extractCodeFromBlock(block);
        if (!code) {
          toast.show({ message: "代码为空，无法复制", variant: "error" });
          return;
        }

        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = "已复制";
          toast.show({ message: "代码已复制到剪贴板", variant: "success" });
          window.setTimeout(() => {
            btn.textContent = "复制";
          }, 2000);
        } catch {
          toast.show({ message: "复制失败，请检查浏览器权限", variant: "error" });
        }
      });

      langBar.appendChild(btn);
    });
  }, [toast]);

  useEffect(() => {
    attachCopyButtons();
  }, [html, attachCopyButtons]);

  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
