"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Check } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";

function ResetPasswordForm() {
  const [account, setAccount] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const accountReady = account.trim().length >= 3;
  const codeReady = /^\d{6}$/.test(code);
  const passwordReady = password.length >= 8;
  const ready = accountReady && codeReady && passwordReady && password === confirm;

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function sendCode() {
    if (!accountReady) {
      setError("请输入用户名或邮箱");
      return;
    }
    setError("");
    setSendingCode(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ account }),
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accountReady) {
      setError("请输入用户名或邮箱");
      return;
    }
    if (!codeReady) {
      setError("请输入收到的 6 位验证码");
      return;
    }
    if (!passwordReady) {
      setError("密码至少 8 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ account, code, password }),
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) {
        setError(json.message || "重置失败，请重试");
        return;
      }
      setSuccess(json.message || "密码已重置");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="auth-form">
        <div className="auth-success" role="status">
          <Check size={20} aria-hidden="true" />
          <p>{success}</p>
        </div>
        <Link href="/login" className="auth-submit auth-submit-link">
          去登录
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <div className="auth-field">
        <label className="auth-label" htmlFor="reset-account">
          用户名或邮箱
        </label>
        <div className="auth-code-row">
          <input
            id="reset-account"
            className="auth-input"
            autoComplete="username"
            enterKeyHint="next"
            placeholder="输入注册时填写的用户名或邮箱"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
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
            disabled={sendingCode || countdown > 0 || !accountReady}
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
          <label className="auth-label" htmlFor="reset-code">
            验证码
          </label>
          <input
            id="reset-code"
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
        <label className="auth-label" htmlFor="reset-password">
          新密码
        </label>
        <div className="auth-input-wrap">
          <input
            id="reset-password"
            className="auth-input auth-input-with-action"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            enterKeyHint="next"
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

      <div className="auth-field">
        <label className="auth-label" htmlFor="reset-confirm">
          确认新密码
        </label>
        <input
          id="reset-confirm"
          className="auth-input"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          enterKeyHint="go"
          placeholder="再次输入新密码"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
        />
      </div>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="auth-submit" disabled={loading || !ready}>
        {loading ? (
          <span className="auth-submit-loading">
            <span className="auth-spinner" />
            重置中…
          </span>
        ) : (
          "确认重置"
        )}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell mode="reset">
      <Suspense fallback={<div className="auth-form-skeleton" aria-hidden="true" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
