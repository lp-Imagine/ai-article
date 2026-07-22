"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { SliderCaptcha } from "@/components/slider-captcha";
import { markOnboardingPending } from "@/lib/onboarding";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaOk, setCaptchaOk] = useState(false);
  const [captchaReset, setCaptchaReset] = useState(0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
          password,
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
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
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

        <SliderCaptcha
          verified={captchaOk}
          onVerifiedChange={setCaptchaOk}
          resetSignal={captchaReset}
        />

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="auth-submit"
          disabled={
            loading || username.trim().length < 3 || password.length < 6 || !captchaOk
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
