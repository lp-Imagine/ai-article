"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, Home, Settings, Sparkles } from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { BackgroundTaskFloat } from "@/components/background-task-float";
import { BackgroundTaskSidebarHint } from "@/components/background-task-sidebar-hint";

const navItems = [
  { href: "/", label: "工作台", icon: Home },
  { href: "/history", label: "历史", icon: Clock3 },
  { href: "/settings", label: "设置", icon: Settings },
];

function pageTitleForPath(pathname: string): string | null {
  if (pathname === "/") return "工作台";
  if (pathname === "/history") return "历史记录";
  if (pathname === "/settings") return "设置";
  if (pathname.startsWith("/articles/")) return "文章编辑";
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mobileTitle = pageTitleForPath(pathname);
  const isArticleEditor = pathname.startsWith("/articles/");

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-brand">
          <div className="app-logo">
            <Sparkles size={18} strokeWidth={2.2} />
          </div>
          <div>
            <p className="app-brand-title">AI 发文助手</p>
            <p className="app-brand-sub">Editorial Studio</p>
          </div>
        </div>

        <nav className="app-nav">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={clsx("app-nav-item", active && "app-nav-item-active")}
              >
                <Icon size={16} strokeWidth={2} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          <BackgroundTaskSidebarHint />
          <p>选题 → 大纲 → 正文 → 推送</p>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-mobile-header">
          <div className="app-mobile-brand">
            <div className="app-logo">
              <Sparkles size={16} strokeWidth={2.2} />
            </div>
            <div className="app-mobile-brand-text">
              <span className="app-brand-title">AI 发文助手</span>
              {mobileTitle ? <span className="app-mobile-page-title">{mobileTitle}</span> : null}
            </div>
          </div>
        </header>

        <div className={clsx("app-content", isArticleEditor && "app-content-article")}>{children}</div>

        <nav className="app-mobile-bottom-nav" aria-label="主导航">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={clsx("app-mobile-bottom-item", active && "app-mobile-bottom-item-active")}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <BackgroundTaskFloat />
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx("page-header", className)}>
      <div className="page-header-main">
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionCard({
  title,
  description,
  children,
  className,
  headerExtra,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  headerExtra?: ReactNode;
}) {
  return (
    <section className={clsx("section-card", className)}>
      <div className="section-card-header">
        <div>
          <h2 className="section-card-title">{title}</h2>
          {description ? <p className="section-card-desc">{description}</p> : null}
        </div>
        {headerExtra}
      </div>
      <div className="section-card-body">{children}</div>
    </section>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="field-label">{children}</label>;
}
