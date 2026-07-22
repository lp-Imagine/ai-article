"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clock3, Home, LogOut, Settings, Sparkles, Users } from "lucide-react";
import clsx from "clsx";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BackgroundTaskFloat } from "@/components/background-task-float";
import { BackgroundTaskSidebarHint } from "@/components/background-task-sidebar-hint";
import { OnboardingTour } from "@/components/onboarding-tour";

type MeUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: "USER" | "SUPER_ADMIN";
};

const baseNavItems = [
  { href: "/", label: "工作台", icon: Home, tour: "nav-home" },
  { href: "/history", label: "历史", icon: Clock3, tour: "nav-history" },
  { href: "/settings", label: "设置", icon: Settings, tour: "nav-settings" },
];

function pageTitleForPath(pathname: string): string | null {
  if (pathname === "/") return "工作台";
  if (pathname === "/history") return "历史记录";
  if (pathname === "/settings") return "设置";
  if (pathname.startsWith("/articles/")) return "文章编辑";
  if (pathname.startsWith("/admin/users")) return "用户管理";
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = pathname === "/login" || pathname === "/register";
  const mobileTitle = pageTitleForPath(pathname);
  const isArticleEditor = pathname.startsWith("/articles/");
  const [me, setMe] = useState<MeUser | null>(null);

  useEffect(() => {
    if (isAuthPage) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && json.code === 0) {
          setMe(json.data);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthPage, pathname]);

  const navItems = useMemo(() => {
    if (me?.role === "SUPER_ADMIN") {
      return [...baseNavItems, { href: "/admin/users", label: "用户", icon: Users, tour: "nav-users" }];
    }
    return baseNavItems;
  }, [me?.role]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    router.replace("/login");
    router.refresh();
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-brand">
          <div className="app-logo">
            <Sparkles size={18} strokeWidth={2.2} />
          </div>
          <div>
            <p className="app-brand-title">Draftly</p>
            <p className="app-brand-sub">内容工作台</p>
          </div>
        </div>

        <nav className="app-nav">
          {navItems.map(({ href, label, icon: Icon, tour }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                data-tour={tour}
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
          {me ? (
            <div className="app-sidebar-user">
              <div className="app-sidebar-user-meta">
                <p className="app-sidebar-user-name">{me.displayName || me.username}</p>
                <p className="app-sidebar-user-role">
                  {me.role === "SUPER_ADMIN" ? "超级管理员" : "用户"}
                </p>
              </div>
              <button type="button" className="app-sidebar-logout" onClick={() => void logout()} title="退出登录">
                <LogOut size={14} />
                退出
              </button>
            </div>
          ) : (
            <p>选题 → 大纲 → 正文 → 推送</p>
          )}
        </div>
      </aside>

      <div className="app-main">
        <header className="app-mobile-header">
          <div className="app-mobile-brand">
            <div className="app-logo">
              <Sparkles size={16} strokeWidth={2.2} />
            </div>
            <div className="app-mobile-brand-text">
              <span className="app-brand-title">Draftly</span>
              {mobileTitle ? <span className="app-mobile-page-title">{mobileTitle}</span> : null}
            </div>
          </div>
          {me ? (
            <div className="app-mobile-user">
              <div className="app-mobile-user-meta">
                <span className="app-mobile-user-name">{me.displayName || me.username}</span>
                {me.role === "SUPER_ADMIN" ? (
                  <span className="app-mobile-user-role">管理员</span>
                ) : null}
              </div>
              <button type="button" className="app-mobile-logout" onClick={() => void logout()} aria-label="退出登录">
                <LogOut size={18} />
              </button>
            </div>
          ) : null}
        </header>

        <div className={clsx("app-content", isArticleEditor && "app-content-article")}>{children}</div>

        <nav className="app-mobile-bottom-nav" aria-label="主导航">
          {navItems.map(({ href, label, icon: Icon, tour }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                data-tour={tour}
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
      {me ? <OnboardingTour userId={me.id} /> : null}
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
