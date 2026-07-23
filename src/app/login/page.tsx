"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Check } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { SliderCaptcha } from "@/components/slider-captcha";

const REMEMBER_KEY = "draftly_login_remember";

type RememberPayload = {
  username: string;
  password: string;
};

function readRemembered(): RememberPayload | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<RememberPayload>;
    if (!data.username || !data.password) return null;
    return { username: data.username, password: data.password };
  } catch {
    return null;
  }
}

function writeRemembered(payload: RememberPayload | null) {
  try {
    if (!payload) {
      localStorage.removeItem(REMEMBER_KEY);
      return;
    }
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [captchaOk, setCaptchaOk] = useState(false);
  const [captchaReset, setCaptchaReset] = useState(0);
  const credentialsReady = Boolean(username.trim() && password);

  useEffect(() => {
    const saved = readRemembered();
    if (saved) {
      setUsername(saved.username);
      setPassword(saved.password);
      setRemember(true);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (credentialsReady) return;
    if (!captchaOk) return;
    setCaptchaOk(false);
    setCaptchaReset((n) => n + 1);
  }, [credentialsReady, captchaOk]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!credentialsReady) {
      setError("请先填写用户名和密码");
      return;
    }
    if (!captchaOk) {
      setError("请先完成滑块验证");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password, remember }),
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) {
        setError(json.message || "登录失败");
        setCaptchaReset((n) => n + 1);
        return;
      }

      writeRemembered(remember ? { username, password } : null);

      // 整页跳转，确保中间件能读到刚写入的会话 Cookie
      const target = next.startsWith("/") ? next : "/";
      window.location.assign(target);
    } catch {
      setError("网络错误，请重试");
      setCaptchaReset((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <div className="auth-field">
        <label className="auth-label" htmlFor="username">
          用户名
        </label>
        <input
          id="username"
          className="auth-input"
          autoComplete="username"
          inputMode="text"
          enterKeyHint="next"
          placeholder="输入用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="password">
          密码
        </label>
        <div className="auth-input-wrap">
          <input
            id="password"
            className="auth-input auth-input-with-action"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            enterKeyHint="go"
            placeholder="输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="auth-input-action"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <label
        className={`auth-remember${remember ? " auth-remember-on" : ""}${hydrated ? "" : " auth-remember-pending"}`}
      >
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => {
            const checked = e.target.checked;
            setRemember(checked);
            if (!checked) writeRemembered(null);
          }}
        />
        <span className="auth-remember-box" aria-hidden="true">
          {remember ? <Check size={14} strokeWidth={2.6} /> : null}
        </span>
        <span className="auth-remember-copy">
          <span className="auth-remember-title">记住密码</span>
          <span className="auth-remember-desc">自动填入账号，会话保持 30 天</span>
        </span>
      </label>

      {credentialsReady ? (
        <SliderCaptcha
          verified={captchaOk}
          onVerifiedChange={setCaptchaOk}
          resetSignal={captchaReset}
        />
      ) : null}

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="auth-submit"
        disabled={loading || !credentialsReady || !captchaOk}
      >
        {loading ? (
          <span className="auth-submit-loading">
            <span className="auth-spinner" />
            登录中…
          </span>
        ) : (
          "进入工作台"
        )}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell mode="login">
      <Suspense fallback={<div className="auth-form-skeleton" aria-hidden="true" />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
