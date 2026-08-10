"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PenLine, Send, ShieldCheck, Sparkles } from "lucide-react";
import {
  ICP_BEIAN_NO,
  ICP_BEIAN_URL,
  PUBLIC_SECURITY_BEIAN_NO,
  PUBLIC_SECURITY_BEIAN_URL,
} from "@/lib/site-beian";

type AuthShellProps = {
  mode: "login" | "register" | "reset";
  children: ReactNode;
};

const COPY: Record<
  AuthShellProps["mode"],
  {
    heroTitle: ReactNode;
    heroDesc: ReactNode;
    eyebrow: string;
    title: string;
    lead: string;
    footer: ReactNode;
  }
> = {
  login: {
    heroTitle: (
      <>
        从选题到草稿箱
        <br />
        一条链路写完
      </>
    ),
    heroDesc:
      "登录后继续大纲、正文、配图与推送，把公众号创作收进同一套工作流。",
    eyebrow: "欢迎回来",
    title: "登录账号",
    lead: "使用用户名与密码进入工作台",
    footer: (
      <>
        还没有账号？<Link href="/register">去注册</Link>
      </>
    ),
  },
  register: {
    heroTitle: (
      <>
        创建你的写作空间
        <br />
        数据完全独立
      </>
    ),
    heroDesc:
      "注册即可拥有独立的文章、设置与推送配置，适合个人或多人协作使用。",
    eyebrow: "开始使用",
    title: "注册账号",
    lead: "填写基础信息，马上开始创作",
    footer: (
      <>
        已有账号？<Link href="/login">去登录</Link>
      </>
    ),
  },
  reset: {
    heroTitle: (
      <>
        设置新密码
        <br />
        重新出发
      </>
    ),
    heroDesc: "邮箱验证已通过，请设置一个新密码。",
    eyebrow: "设置新密码",
    title: "重置密码",
    lead: "验证通过，请设置新密码",
    footer: (
      <>
        已完成？<Link href="/login">去登录</Link>
      </>
    ),
  },
};

export function AuthShell({ mode, children }: AuthShellProps) {
  const copy = COPY[mode];

  return (
    <div className="auth-page">
      <div className="auth-ambient" aria-hidden="true">
        <span className="auth-orb auth-orb-a" />
        <span className="auth-orb auth-orb-b" />
        <span className="auth-grid" />
      </div>

      <div className="auth-shell">
        <aside className="auth-hero">
          <div className="auth-hero-inner">
            <div className="auth-hero-brand">
              <div className="auth-logo">
                <Sparkles size={22} strokeWidth={2.2} />
              </div>
              <div>
                <p className="auth-hero-name">Draftly</p>
                <p className="auth-hero-tag">内容工作台</p>
              </div>
            </div>

            <div className="auth-hero-copy">
              <h1 className="auth-hero-title">{copy.heroTitle}</h1>
              <p className="auth-hero-desc">{copy.heroDesc}</p>
            </div>

            <ul className="auth-hero-points">
              <li>
                <span className="auth-hero-point-icon" aria-hidden="true">
                  <PenLine size={16} strokeWidth={2.1} />
                </span>
                <span className="auth-hero-point-text">
                  <strong>写作链路</strong>
                  <span>一站完成选题、大纲与正文</span>
                </span>
              </li>
              <li>
                <span className="auth-hero-point-icon" aria-hidden="true">
                  <Send size={16} strokeWidth={2.1} />
                </span>
                <span className="auth-hero-point-text">
                  <strong>发布闭环</strong>
                  <span>配图预览后直达公众号草稿</span>
                </span>
              </li>
              <li>
                <span className="auth-hero-point-icon" aria-hidden="true">
                  <ShieldCheck size={16} strokeWidth={2.1} />
                </span>
                <span className="auth-hero-point-text">
                  <strong>数据隔离</strong>
                  <span>账号独立，内容互不干扰</span>
                </span>
              </li>
            </ul>
          </div>
        </aside>

        <main className="auth-panel">
          <div className="auth-panel-inner">
            <header className="auth-panel-head">
              <div className="auth-panel-brand-mobile">
                <div className="auth-logo auth-logo-sm">
                  <Sparkles size={16} strokeWidth={2.2} />
                </div>
                <span>Draftly</span>
              </div>
              <p className="auth-panel-eyebrow">{copy.eyebrow}</p>
              <h2 className="auth-panel-title">{copy.title}</h2>
              <p className="auth-panel-lead">{copy.lead}</p>
            </header>

            {children}

            <p className="auth-footer">{copy.footer}</p>
          </div>
        </main>
      </div>

      <footer className="auth-beian">
        <a
          className="auth-beian-chip"
          href={ICP_BEIAN_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="查询工信部备案信息"
        >
          <span className="auth-beian-mark" aria-hidden="true" />
          <span className="auth-beian-meta">
            <span className="auth-beian-label">ICP</span>
            <span className="auth-beian-no">{ICP_BEIAN_NO}</span>
          </span>
          <span className="auth-beian-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
        <a
          className="auth-beian-chip"
          href={PUBLIC_SECURITY_BEIAN_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="查询公安备案信息"
        >
          <img
            className="auth-beian-gongan-mark"
            src="/beian-gongan.png"
            alt=""
            aria-hidden="true"
          />
          <span className="auth-beian-meta">
            <span className="auth-beian-label">公网安备</span>
            <span className="auth-beian-no">{PUBLIC_SECURITY_BEIAN_NO}</span>
          </span>
          <span className="auth-beian-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
      </footer>
    </div>
  );
}
