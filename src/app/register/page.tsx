"use client";

import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { SliderCaptcha } from "@/components/slider-captcha";
import { markOnboardingPending } from "@/lib/onboarding";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [captchaOk, setCaptchaOk] = useState(false);
  const [captchaReset, setCaptchaReset] = useState(0);
  const usernameReady = username.trim().length >= 3;
  const emailReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const codeReady = /^\d{6}$/.test(code);
  const credentialsReady =
    usernameReady && emailReady && password.length >= 8;

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (credentialsReady) return;
    if (!captchaOk) return;
    setCaptchaOk(false);
    setCaptchaReset((n) => n + 1);
  }, [credentialsReady, captchaOk]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!credentialsReady) {
      setError("请先填写符合要求的用户名、邮箱和密码");
      return;
    }
    if (codeSent && !codeReady) {
      setError("请输入收到的 6 位验证码");
      return;
    }
    if (!captchaOk) {
      setError("请先完成滑块验证");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username,
          email: email.trim(),
          password,
          code,
          displayName: displayName || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) {
        setError(json.message || "注册失败");
        setCaptchaReset((n) => n + 1);
        return;
      }
      if (json.data?.id) {
        markOnboardingPending(json.data.id);
      }
      window.location.assign("/");
    } catch {
      setError("网络错误，请重试");
      setCaptchaReset((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  async function sendCode() {
    if (!usernameReady || !emailReady) {
      setError("请先填写用户名和邮箱");
      return;
    }
    setError("");
    setSendingCode(true);
    try {
      const res = await fetch("/api/auth/register?action=send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, email: email.trim() }),
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) {
        setError(json.message || "验证码发送失败");
        return;
      }
      setCodeSent(true);
      setCountdown(60);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSendingCode(false);
    }
  }

  return (
    <AuthShell mode="register">
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
            placeholder="至少 3 个字符"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="email">
            邮箱
          </label>
          <div className="auth-code-row">
            <input
              id="email"
              className="auth-input"
              type="email"
              autoComplete="email"
              enterKeyHint="next"
              placeholder="用于接收验证码"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setCode("");
                setCodeSent(false);
                setCountdown(0);
              }}
              required
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="auth-code-btn"
              onClick={() => void sendCode()}
              disabled={sendingCode || countdown > 0 || !usernameReady || !emailReady}
            >
              {countdown > 0
                ? `${countdown}s 后重发`
                : sendingCode
                  ? "发送中…"
                  : codeSent
                    ? "重新发送"
                    : "发送验证码"}
            </button>
          </div>
        </div>

        {codeSent ? (
          <div className="auth-field">
            <label className="auth-label" htmlFor="code">
              验证码
            </label>
            <input
              id="code"
              className="auth-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="next"
              placeholder="输入邮件中的 6 位验证码"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              required
            />
          </div>
        ) : null}

        <div className="auth-field">
          <label className="auth-label" htmlFor="displayName">
            显示名 <span className="auth-label-optional">可选</span>
          </label>
          <input
            id="displayName"
            className="auth-input"
            autoComplete="nickname"
            enterKeyHint="next"
            placeholder="用于界面展示"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
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
              autoComplete="new-password"
              enterKeyHint="go"
              placeholder="至少 8 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
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
          disabled={
            loading ||
            !credentialsReady ||
            (codeSent && !codeReady) ||
            !captchaOk
          }
        >
          {loading ? (
            <span className="auth-submit-loading">
              <span className="auth-spinner" />
              注册中…
            </span>
          ) : (
            "创建账号"
          )}
        </button>
      </form>
    </AuthShell>
  );
}
