"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Image as ImageIcon,
  MessageSquare,
  PenLine,
  Save,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { FieldLabel, PageHeader, SectionCard } from "@/components/app-shell";
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

type SettingsSection = "ai" | "writing" | "wechat";

const navSections: { id: SettingsSection; label: string; icon: typeof Bot }[] = [
  { id: "ai", label: "AI 模型", icon: Bot },
  { id: "writing", label: "写作默认", icon: PenLine },
  { id: "wechat", label: "微信公众号", icon: MessageSquare },
];

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const [configs, setConfigs] = useState<AppConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [testingWechat, setTestingWechat] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("ai");

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

  const textConfigured = useMemo(
    () => Boolean(getValue("aiApiKey") && getValue("textModelName")),
    [configs],
  );
  const imageConfigured = useMemo(
    () => Boolean(getValue("imageModelName") && (getValue("imageApiKey") || getValue("aiApiKey"))),
    [configs],
  );
  const wechatConfigured = useMemo(
    () => Boolean(getValue("wechatAppId") && getValue("wechatAppSecret")),
    [configs],
  );

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
    } catch {
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

  const textFields = [
    { key: "aiApiKey", label: "AI API Key", placeholder: "sk-...", type: "password" },
    { key: "aiBaseUrl", label: "AI Base URL", placeholder: "https://api.openai.com/v1" },
    { key: "textModelName", label: "文本模型名称", placeholder: "gpt-4o-mini" },
    { key: "textMaxContentTokens", label: "文本最大 Token 数", placeholder: "4096" },
  ];

  const imageFields = [
    { key: "imageApiKey", label: "图片 API Key（可选）", placeholder: "留空则使用 AI API Key" },
    { key: "imageBaseUrl", label: "图片 API Base URL", placeholder: "https://ark.cn-beijing.volces.com/api/v3" },
    { key: "imageModelName", label: "图片模型名称", placeholder: "doubao-seedream-4-5-251128" },
  ];

  const wechatFields = [
    { key: "wechatAppId", label: "微信公众号 App ID", placeholder: "wx..." },
    { key: "wechatAppSecret", label: "微信公众号 App Secret", placeholder: "", type: "password" },
  ];

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 text-sm text-[var(--muted)]">
        <span className="loading-dot" />
        加载配置中...
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="设置"
        description="配置 AI 接口与微信公众号接入。左侧切换分类，底部统一保存。"
      />

      <div className="settings-layout">
        <nav className="settings-nav">
          {navSections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={clsx("settings-nav-item", activeSection === id && "settings-nav-item-active")}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {activeSection === "ai" && (
            <SectionCard
              title="AI 模型配置"
              description="文本生成与图片生成所需的 API 连接信息。"
            >
              <div className="space-y-5">
                <div className="config-group">
                  <div className="config-group-title">
                    <h3 className="inline-flex items-center gap-2">
                      <Sparkles size={15} />
                      文本模型
                    </h3>
                    <span className={clsx("config-status", textConfigured ? "config-status-ok" : "config-status-empty")}>
                      {textConfigured ? "已填写" : "待配置"}
                    </span>
                  </div>
                  <div className="config-fields config-fields-2">
                    {textFields.map((f) => (
                      <div key={f.key}>
                        <FieldLabel>{f.label}</FieldLabel>
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
                </div>

                <div className="config-group">
                  <div className="config-group-title">
                    <h3 className="inline-flex items-center gap-2">
                      <ImageIcon size={15} />
                      图片模型
                    </h3>
                    <span className={clsx("config-status", imageConfigured ? "config-status-ok" : "config-status-empty")}>
                      {imageConfigured ? "已填写" : "待配置"}
                    </span>
                  </div>
                  <div className="config-fields">
                    {imageFields.map((f) => (
                      <div key={f.key}>
                        <FieldLabel>{f.label}</FieldLabel>
                        <input
                          type="text"
                          value={getValue(f.key)}
                          onChange={(e) => setValue(f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className="mt-2 w-full px-4 py-2.5 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {activeSection === "writing" && (
            <SectionCard
              title="写作默认"
              description="账号背景只影响叙述口吻和举例偏好，不会把每篇文章都写成同一领域。"
            >
              <div className="info-banner mb-5">
                <PenLine size={18} className="info-banner-icon" />
                <p>文章写什么仍由每篇的「主题」决定，这里只设定默认写作风格与人设背景。</p>
              </div>
              <div>
                <FieldLabel>公众号人设 / 简介（可选）</FieldLabel>
                <textarea
                  value={getValue("accountPersona")}
                  onChange={(e) => setValue("accountPersona", e.target.value)}
                  placeholder="例如：Penn前端智能实验室｜从前端到 AI Agent，记录全栈开发与智能体实践。作者：前端工程师。"
                  rows={5}
                  className="mt-2 w-full px-4 py-3 text-sm resize-y min-h-[120px]"
                />
              </div>
            </SectionCard>
          )}

          {activeSection === "wechat" && (
            <SectionCard
              title="微信公众号配置"
              description="配置完成后即可将文章推送到公众号草稿箱。"
            >
              <div className="config-group mb-5">
                <div className="config-group-title">
                  <h3 className="inline-flex items-center gap-2">
                    <MessageSquare size={15} />
                    接入凭证
                  </h3>
                  <span className={clsx("config-status", wechatConfigured ? "config-status-ok" : "config-status-empty")}>
                    {wechatConfigured ? "已填写" : "待配置"}
                  </span>
                </div>
                <div className="config-fields">
                  {wechatFields.map((f) => (
                    <div key={f.key}>
                      <FieldLabel>{f.label}</FieldLabel>
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
              </div>

              <div className="info-banner">
                <MessageSquare size={18} className="info-banner-icon" />
                <p>
                  App ID 和 App Secret 可在微信公众平台「开发 → 基本配置」中获取。
                  推送后文章会保存为草稿，不会立即发布。
                </p>
              </div>

              <div className="mt-5 flex justify-end">
                <button onClick={handleTestWechat} disabled={testingWechat} className="btn-secondary text-sm">
                  {testingWechat ? "验证中..." : "验证微信连通"}
                </button>
              </div>
            </SectionCard>
          )}

          <div className="settings-footer">
            <p className="settings-footer-hint">
              修改配置后记得保存。可先验证模型连通性，再开始创作。
            </p>
            <div className="settings-footer-actions">
              {activeSection === "ai" && (
                <>
                  <button onClick={handleTestModel} disabled={testing} className="btn-secondary text-sm">
                    {testing ? "验证中..." : "验证文本模型"}
                  </button>
                  <button onClick={handleTestImageModel} disabled={testingImage} className="btn-secondary text-sm">
                    {testingImage ? "验证中..." : "验证图片模型"}
                  </button>
                </>
              )}
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
                {saving ? (
                  "保存中..."
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Save size={14} />
                    保存配置
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
