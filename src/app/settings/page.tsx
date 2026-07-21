"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";

type AppConfig = {
  key: string;
  value: string;
};

type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const [configs, setConfigs] = useState<AppConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [testingWechat, setTestingWechat] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/configs");
        const json = (await res.json()) as ApiResponse<Record<string, string>>;
        if (json.code === 0 && json.data) {
          const list: AppConfig[] = Object.entries(json.data).map(([key, value]) => ({ key, value }));
          setConfigs(list);
        }
      } catch {
        toast.show({ message: "加载配置失败", variant: "error" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function getValue(key: string): string {
    return configs.find((c) => c.key === key)?.value ?? "";
  }

  function setValue(key: string, value: string) {
    setConfigs((prev) => {
      const exists = prev.find((c) => c.key === key);
      if (exists) return prev.map((c) => (c.key === key ? { ...c, value } : c));
      return [...prev, { key, value }];
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      for (const c of configs) {
        body[c.key] = c.value;
      }
      const res = await fetch("/api/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (json.code !== 0) throw new Error(json.message || "保存失败");
      toast.show({ message: "配置已保存", variant: "success" });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      toast.show({ message, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestModel() {
    setTesting(true);
    try {
      const res = await fetch("/api/configs/ping");
      const json = await res.json() as ApiResponse<{ configured: boolean; baseUrl?: string; model?: string; error?: string }>;
      if (json.code === 0 && json.data?.configured && !json.data?.error) {
        toast.show({ message: `模型验证通过 ✓ (${json.data.model ?? "ok"})`, variant: "success" });
      } else {
        toast.show({ message: json.data?.error || json.message || "模型验证失败", variant: "error" });
      }
    } catch (err) {
      toast.show({ message: "验证请求失败", variant: "error" });
    } finally {
      setTesting(false);
    }
  }

  async function handleTestImageModel() {
    setTestingImage(true);
    try {
      const res = await fetch("/api/configs/ping-image");
      const json = await res.json() as ApiResponse<{ configured: boolean; baseUrl?: string; model?: string; error?: string }>;
      if (json.code === 0 && json.data?.configured && !json.data?.error) {
        toast.show({ message: `图片模型验证通过 ✓ (${json.data.model ?? "ok"})`, variant: "success" });
      } else {
        toast.show({ message: json.data?.error || json.message || "图片模型验证失败", variant: "error" });
      }
    } catch {
      toast.show({ message: "验证请求失败", variant: "error" });
    } finally {
      setTestingImage(false);
    }
  }

  async function handleTestWechat() {
    setTestingWechat(true);
    try {
      const res = await fetch("/api/configs/ping-wechat");
      const json = await res.json() as ApiResponse<{ configured: boolean; note?: string; error?: string }>;
      if (json.code === 0 && json.data?.configured && !json.data?.error) {
        toast.show({ message: `微信连通成功 ✓ ${json.data.note ?? ""}`, variant: "success" });
      } else {
        toast.show({ message: json.data?.error || json.message || "微信验证失败", variant: "error" });
      }
    } catch {
      toast.show({ message: "验证请求失败", variant: "error" });
    } finally {
      setTestingWechat(false);
    }
  }

  const fields = [
    { key: "aiApiKey", label: "AI API Key", placeholder: "sk-...", type: "password" },
    { key: "aiBaseUrl", label: "AI Base URL", placeholder: "https://api.openai.com/v1" },
    { key: "textModelName", label: "文本模型名称", placeholder: "gpt-4o-mini" },
    { key: "textMaxContentTokens", label: "文本最大 Token 数", placeholder: "4096" },
    { key: "imageApiKey", label: "图片 API Key（可选）", placeholder: "留空则使用 AI API Key" },
    { key: "imageBaseUrl", label: "图片 API Base URL", placeholder: "https://ark.cn-beijing.volces.com/api/v3" },
    { key: "imageModelName", label: "图片模型名称", placeholder: "doubao-seedream-4-5-251128" },
  ];

  const wechatFields = [
    { key: "wechatAppId", label: "微信公众号 App ID", placeholder: "wx..." },
    { key: "wechatAppSecret", label: "微信公众号 App Secret", placeholder: "", type: "password" },
  ];

  const writingFields = [
    {
      key: "accountPersona",
      label: "公众号人设 / 简介（可选）",
      placeholder: "例如：Penn前端智能实验室｜从前端到 AI Agent，记录全栈开发与智能体实践。作者：前端工程师。",
      multiline: true,
    },
  ];

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-8 py-10">
        <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
          <span className="inline-block size-2 animate-pulse rounded-full bg-[var(--accent)]" style={{ boxShadow: "0 0 8px var(--accent-glow)" }} />
          加载配置中...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[720px] px-8 py-12">
      <div className="flex items-center justify-between border-b border-[var(--line)] pb-6 mb-8">
        <div>
          <Link href="/" className="btn-ghost text-xs mb-2 inline-block">
            ← 返回工作台
          </Link>
          <h1 className="editorial-title text-3xl font-bold">设置</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">配置 AI 接口与微信公众号接入</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleTestModel} disabled={testing} className="btn-secondary text-sm py-2">
            {testing ? "验证中..." : "验证文本模型"}
          </button>
          <button onClick={handleTestImageModel} disabled={testingImage} className="btn-secondary text-sm py-2">
            {testingImage ? "验证中..." : "验证图片模型"}
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm py-2">
            {saving ? "保存中..." : "保存配置"}
          </button>
        </div>
      </div>

      {/* AI 配置 */}
      <section className="glass p-6 mb-6">
        <h2 className="editorial-title text-lg font-semibold mb-4">AI 模型配置</h2>
        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="text-xs uppercase tracking-widest text-[var(--muted)]">{f.label}</label>
              <input
                type={f.type ?? "text"}
                value={getValue(f.key)}
                onChange={(e) => setValue(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="mt-2 w-full px-4 py-2.5 text-sm"
              />
            </div>
          ))}
        </div>
      </section>

      {/* 写作默认 */}
      <section className="glass p-6 mb-6">
        <h2 className="editorial-title text-lg font-semibold mb-1">写作默认</h2>
        <p className="text-xs text-[var(--muted)] mb-4">
          账号背景只影响叙述口吻和举例偏好，不会把每篇文章都写成同一领域。文章写什么仍由每篇的「主题」决定。
        </p>
        <div className="space-y-4">
          {writingFields.map((f) => (
            <div key={f.key}>
              <label className="text-xs uppercase tracking-widest text-[var(--muted)]">{f.label}</label>
              {f.multiline ? (
                <textarea
                  value={getValue(f.key)}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={4}
                  className="mt-2 w-full px-4 py-2.5 text-sm resize-y min-h-[96px]"
                />
              ) : (
                <input
                  type="text"
                  value={getValue(f.key)}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="mt-2 w-full px-4 py-2.5 text-sm"
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 微信公众号配置 */}
      <section className="glass p-6">
        <h2 className="editorial-title text-lg font-semibold mb-4">微信公众号配置</h2>
        <div className="space-y-4">
          {wechatFields.map((f) => (
            <div key={f.key}>
              <label className="text-xs uppercase tracking-widest text-[var(--muted)]">{f.label}</label>
              <input
                type={f.type ?? "text"}
                value={getValue(f.key)}
                onChange={(e) => setValue(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="mt-2 w-full px-4 py-2.5 text-sm"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-[var(--muted)]">
            配置完成后即可将文章推送到公众号草稿箱。App ID 和 App Secret 可在微信公众平台「开发 → 基本配置」中获取。
          </p>
          <button onClick={handleTestWechat} disabled={testingWechat} className="btn-secondary text-sm py-2 shrink-0">
            {testingWechat ? "验证中..." : "验证微信"}
          </button>
        </div>
      </section>
    </main>
  );
}
