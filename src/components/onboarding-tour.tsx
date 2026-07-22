"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Sparkles, X } from "lucide-react";
import {
  clearOnboardingPending,
  isOnboardingPendingFor,
  markOnboardingDone,
} from "@/lib/onboarding";

type Step = {
  id: string;
  title: string;
  description: string;
  /** CSS selector for spotlight; null = center card only */
  target: string | null;
  /** Prefer this route so the target exists */
  route?: string;
};

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "欢迎加入 Draftly",
    description: "用几步熟悉工作台：先配置模型，再从主题走到公众号草稿箱。",
    target: null,
  },
  {
    id: "settings",
    title: "先去设置里配置模型",
    description: "在「设置」填写 AI API Key、模型与（可选）微信公众号，否则会走本地模板，效果有限。",
    target: '[data-tour="nav-settings"]',
    route: "/",
  },
  {
    id: "workspace",
    title: "在工作台开始创作",
    description: "填写主题后生成大纲，选定方向再写正文、配图，最后推送到草稿箱。",
    target: '[data-tour="home-create"]',
    route: "/",
  },
  {
    id: "history",
    title: "历史记录随时回看",
    description: "所有文章都在「历史」里，可继续编辑、删除，或批量清理。",
    target: '[data-tour="nav-history"]',
    route: "/",
  },
  {
    id: "done",
    title: "可以开始了",
    description: "建议先完成模型配置，再写第一篇。需要时也可在侧栏随时切换页面。",
    target: null,
  },
];

type Rect = { top: number; left: number; width: number; height: number };

type Props = {
  userId: string;
};

export function OnboardingTour({ userId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  useEffect(() => {
    if (!userId) return;
    if (isOnboardingPendingFor(userId)) {
      setOpen(true);
      setStepIndex(0);
    }
  }, [userId]);

  const measure = useCallback(() => {
    if (!step?.target) {
      setRect(null);
      return;
    }
    const nodes = document.querySelectorAll(step.target);
    let el: HTMLElement | null = null;
    for (const node of Array.from(nodes)) {
      const html = node as HTMLElement;
      const style = window.getComputedStyle(html);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = html.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      el = html;
      break;
    }
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 8;
    setRect({
      top: Math.max(8, r.top - pad),
      left: Math.max(8, r.left - pad),
      width: Math.min(window.innerWidth - 16, r.width + pad * 2),
      height: Math.min(window.innerHeight - 16, r.height + pad * 2),
    });
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    const preferred = step?.route;
    if (preferred && pathname !== preferred) {
      router.push(preferred);
      return;
    }
    const t = window.setTimeout(measure, 80);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, pathname, router, measure]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const cardStyle = useMemo(() => {
    if (!rect || typeof window === "undefined") return undefined;
    const cardW = Math.min(360, window.innerWidth - 32);
    const gap = 14;
    let top = rect.top + rect.height + gap;
    let left = Math.min(rect.left, window.innerWidth - cardW - 16);
    left = Math.max(16, left);

    // Prefer below; if not enough space, place above
    if (top + 220 > window.innerHeight) {
      top = Math.max(16, rect.top - gap - 210);
    }
    // Mobile: keep card near bottom for thumb reach when spotlight is in bottom nav
    if (window.innerWidth < 1024 && rect.top > window.innerHeight * 0.55) {
      top = Math.max(16, rect.top - gap - 200);
    }
    return { top, left, width: cardW };
  }, [rect]);

  function finish() {
    markOnboardingDone(userId);
    clearOnboardingPending();
    setOpen(false);
  }

  function skip() {
    finish();
  }

  function next() {
    if (isLast) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function prev() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  if (!open) return null;

  return (
    <div className="onboarding-root" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-dim" />
      {rect ? (
        <div
          className="onboarding-spot"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : null}

      <div
        className={`onboarding-card${rect ? " onboarding-card-anchored" : " onboarding-card-center"}`}
        style={rect ? cardStyle : undefined}
      >
        <div className="onboarding-card-head">
          <div className="onboarding-badge">
            <Sparkles size={14} />
            新手指引
          </div>
          <button type="button" className="onboarding-close" onClick={skip} aria-label="跳过指引">
            <X size={16} />
          </button>
        </div>

        <p className="onboarding-step-count">
          {stepIndex + 1} / {STEPS.length}
        </p>
        <h2 id="onboarding-title" className="onboarding-title">
          {step.title}
        </h2>
        <p className="onboarding-desc">{step.description}</p>

        <div className="onboarding-actions">
          {stepIndex > 0 ? (
            <button type="button" className="btn-secondary btn-sm" onClick={prev}>
              上一步
            </button>
          ) : (
            <button type="button" className="btn-secondary btn-sm" onClick={skip}>
              跳过
            </button>
          )}
          <button type="button" className="btn-primary btn-sm onboarding-next" onClick={next}>
            {isLast ? "开始使用" : "下一步"}
            {!isLast ? <ArrowRight size={14} /> : null}
          </button>
        </div>
      </div>
    </div>
  );
}
