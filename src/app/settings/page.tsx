"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Globe,
  Image as ImageIcon,
  MessageSquare,
  PenLine,
  Save,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { FieldLabel, PageHeader, SectionCard } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { readApiResponse } from "@/lib/api-client";

type AppConfig = {
  key: string;
  value: string;
};

type SettingsSection = "ai" | "writing" | "wechat" | "blog";

const navSections: { id: SettingsSection; label: string; icon: typeof Bot }[] = [
  { id: "ai", label: "AI 模型", icon: Bot },
  { id: "writing", label: "写作默认", icon: PenLine },
  { id: "wechat", label: "微信公众号", icon: MessageSquare },
  { id: "blog", label: "博客同步", icon: Globe },
];

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const [configs, setConfigs] = useState<AppConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [testingAuxiliary, setTestingAuxiliary] = useState(false);
  const [testingWechat, setTestingWechat] = useState(false);
  const [testingBlog, setTestingBlog] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("ai");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/configs");
        const json = await readApiResponse<Record<string, string>>(res);
        if (json.code === 0 && json.data) {
          const list: AppConfig[] = Object.entries(json.data).map(([key, value]) => ({ key, value }));
          setConfigs(list);
        }
      } catch (err) {
        toast.show({
          message: err instanceof Error ? err.message : "加载配置失败",
          variant: "error",
        });
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readApiResponse<unknown>(res);
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
      const json = await readApiResponse<{
        configured: boolean;
        baseUrl?: string;
        model?: string;
        error?: string;
      }>(res);
      if (json.code === 0 && json.data?.configured && !json.data?.error) {
        toast.show({ message: `模型验证通过 ✓ (${json.data.model ?? "ok"})`, variant: "success" });
      } else {
        toast.show({ message: json.data?.error || json.message || "模型验证失败", variant: "error" });
      }
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "验证请求失败",
        variant: "error",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleTestImageModel() {
    setTestingImage(true);
    try {
      const res = await fetch("/api/configs/ping-image");
      const json = await readApiResponse<{
        configured: boolean;
        baseUrl?: string;
        model?: string;
        error?: string;
      }>(res);
      if (json.code === 0 && json.data?.configured && !json.data?.error) {
        toast.show({ message: `图片模型验证通过 ✓ (${json.data.model ?? "ok"})`, variant: "success" });
      } else {
        toast.show({ message: json.data?.error || json.message || "图片模型验证失败", variant: "error" });
      }
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "验证请求失败",
        variant: "error",
      });
    } finally {
      setTestingImage(false);
    }
  }

  const auxiliaryConfigured = useMemo(
    () => Boolean(getValue("auxiliaryTextModelName")),
    [configs],
  );

  async function handleTestAuxiliaryModel() {
    setTestingAuxiliary(true);
    try {
      const res = await fetch("/api/configs/ping-auxiliary");
      const json = await readApiResponse<{
        configured: boolean;
        baseUrl?: string;
        model?: string;
        error?: string;
        note?: string;
      }>(res);
      if (json.code === 0 && json.data?.configured && !json.data?.error) {
        toast.show({
          message: `辅助模型验证通过 ✓ (${json.data.model ?? "ok"})`,
          variant: "success",
        });
      } else {
        toast.show({ message: json.data?.error || json.message || "辅助模型验证失败", variant: "error" });
      }
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "验证请求失败",
        variant: "error",
      });
    } finally {
      setTestingAuxiliary(false);
    }
  }

  async function handleTestWechat() {
    setTestingWechat(true);
    try {
      const res = await fetch("/api/configs/ping-wechat");
      const json = await readApiResponse<{
        configured: boolean;
        note?: string;
        error?: string;
      }>(res);
      if (json.code === 0 && json.data?.configured && !json.data?.error) {
        toast.show({ message: `微信连通成功 ✓ ${json.data.note ?? ""}`, variant: "success" });
      } else {
        toast.show({ message: json.data?.error || json.message || "微信验证失败", variant: "error" });
      }
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "验证请求失败",
        variant: "error",
      });
    } finally {
      setTestingWechat(false);
    }
  }

  const primaryTextFields = [
    { key: "aiApiKey", label: "AI API Key", placeholder: "sk-...", type: "password" },
    { key: "aiBaseUrl", label: "AI Base URL", placeholder: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    { key: "textModelName", label: "文本模型（主）", placeholder: "qwen-plus / deepseek-v4-pro / gpt-4o" },
    { key: "textMaxContentTokens", label: "文本最大 Token 数", placeholder: "4096" },
  ];

  const auxiliaryTextFields = [
    {
      key: "auxiliaryAiApiKey",
      label: "辅助 API Key（可选）",
      placeholder: "留空则使用主 AI API Key",
      type: "password",
    },
    {
      key: "auxiliaryAiBaseUrl",
      label: "辅助 Base URL（可选）",
      placeholder: "https://api.deepseek.com/v1",
    },
    {
      key: "auxiliaryTextModelName",
      label: "文本模型（辅助）",
      placeholder: "deepseek-v4-flash / qwen-turbo / gpt-4o-mini",
    },
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

  const blogFields = [
    {
      key: "blogGithubToken",
      label: "GitHub Personal Access Token",
      placeholder: "ghp_xxx 或 github_pat_xxx（需 contents:write + actions:write）",
      type: "password",
    },
    {
      key: "blogGithubRepo",
      label: "博客仓库",
      placeholder: "owner/vuepressblog",
    },
    {
      key: "blogGithubBranch",
      label: "博客仓库分支",
      placeholder: "master",
    },
    {
      key: "blogSiteUrl",
      label: "博客站点 URL",
      placeholder: "https://lp-imagine.github.io/vuepressblog/",
    },
  ];

  const blogConfigured = useMemo(
    () => Boolean(getValue("blogGithubToken") && getValue("blogGithubRepo")),
    [configs],
  );

  async function handleTestBlog() {
    setTestingBlog(true);
    try {
      const res = await fetch("/api/configs/ping-blog");
      const json = await readApiResponse<{
        configured: boolean;
        repo?: string;
        branch?: string;
        siteUrl?: string;
        permissions?: Record<string, boolean>;
        note?: string;
        error?: string;
      }>(res);
      if (json.code === 0 && json.data?.configured && !json.data?.error) {
        const perm = json.data.permissions;
        const note = perm
          ? ` ✓ 权限：push=${perm.push ? "✓" : "×"}`
          : "";
        toast.show({
          message: `博客连通成功${json.data.note ?? ""}${note}`,
          variant: "success",
        });
      } else {
        toast.show({ message: json.data?.error || json.message || "博客验证失败", variant: "error" });
      }
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "验证请求失败",
        variant: "error",
      });
    } finally {
      setTestingBlog(false);
    }
  }

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
              description="主模型负责大纲与正文；辅助模型用于配图 prompt、标题、摘要。辅助 API 可独立配置不同厂商，留空则回退到主模型配置。"
            >
              <div className="space-y-5">
                <div className="config-group">
                  <div className="config-group-title">
                    <h3 className="inline-flex items-center gap-2">
                      <Sparkles size={15} />
                      文本模型（主）
                    </h3>
                    <div className="config-group-actions">
                      <span className={clsx("config-status", textConfigured ? "config-status-ok" : "config-status-empty")}>
                        {textConfigured ? "已填写" : "待配置"}
                      </span>
                      <button
                        type="button"
                        onClick={handleTestModel}
                        disabled={testing}
                        className="config-verify-btn"
                      >
                        {testing ? "验证中" : "验证"}
                      </button>
                    </div>
                  </div>
                  <div className="config-fields config-fields-2">
                    {primaryTextFields.map((f) => (
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
                      <Sparkles size={15} />
                      文本模型（辅助）
                    </h3>
                    <div className="config-group-actions">
                      <span className={clsx("config-status", auxiliaryConfigured ? "config-status-ok" : "config-status-empty")}>
                        {auxiliaryConfigured ? "已填写" : "可选"}
                      </span>
                      <button
                        type="button"
                        onClick={handleTestAuxiliaryModel}
                        disabled={testingAuxiliary}
                        className="config-verify-btn"
                      >
                        {testingAuxiliary ? "验证中" : "验证"}
                      </button>
                    </div>
                  </div>
                  <div className="config-fields config-fields-2">
                    {auxiliaryTextFields.map((f) => (
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
                    <div className="config-group-actions">
                      <span className={clsx("config-status", imageConfigured ? "config-status-ok" : "config-status-empty")}>
                        {imageConfigured ? "已填写" : "待配置"}
                      </span>
                      <button
                        type="button"
                        onClick={handleTestImageModel}
                        disabled={testingImage}
                        className="config-verify-btn"
                      >
                        {testingImage ? "验证中" : "验证"}
                      </button>
                    </div>
                  </div>
                  <div className="config-fields">
                    <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
                      Base URL 需支持 OpenAI 兼容的 <code>/images/generations</code>。不要填 DeepSeek
                      等纯文本地址，否则生成封面会 404。Key 可留空以复用上方文本 Key。
                    </p>
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
              description="配置完成后即可将文章推送到公众号草稿箱。未配置时推送会直接失败，不会写入假草稿。"
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

              <div className="mt-5 flex justify-end border-t border-[var(--line)] pt-5">
                <button onClick={handleTestWechat} disabled={testingWechat} className="btn-secondary text-sm">
                  {testingWechat ? "验证中..." : "验证微信连通"}
                </button>
              </div>
            </SectionCard>
          )}

          {activeSection === "blog" && (
            <SectionCard
              title="博客同步配置"
              description="将文章同步到 vuepressblog 仓库的对应栏目并触发 GitHub Actions 部署。Token 仅保存在你的账号下，其他人不会看到。"
            >
              <div className="config-group mb-5">
                <div className="config-group-title">
                  <h3 className="inline-flex items-center gap-2">
                    <Globe size={15} />
                    GitHub 接入
                  </h3>
                  <span className={clsx("config-status", blogConfigured ? "config-status-ok" : "config-status-empty")}>
                    {blogConfigured ? "已填写" : "待配置"}
                  </span>
                </div>
                <div className="config-fields">
                  {blogFields.map((f) => (
                    <div key={f.key}>
                      <FieldLabel>{f.label}</FieldLabel>
                      <input
                        type={f.type ?? "text"}
                        value={getValue(f.key)}
                        onChange={(e) => setValue(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className="mt-2 w-full px-4 py-2.5 text-sm"
                      />
                      {f.key === "blogGithubToken" && getValue(f.key) === "********" ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          已配置 Token（出于安全，前端不回显原值）。如需更换请直接覆盖输入框。
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="info-banner">
                <Globe size={18} className="info-banner-icon" />
                <p>
                  Token 在 GitHub 「Settings → Developer settings → Personal access tokens」生成，
                  至少勾选 <code>contents:write</code> 与 <code>actions:write</code>。保存后点下方「验证博客连通」可一键测试访问权限。
                </p>
              </div>

              <div className="mt-5 flex justify-end border-t border-[var(--line)] pt-5">
                <button onClick={handleTestBlog} disabled={testingBlog} className="btn-secondary text-sm">
                  {testingBlog ? "验证中..." : "验证博客连通"}
                </button>
              </div>
            </SectionCard>
          )}

          <div className="settings-footer">
            <p className="settings-footer-hint">
              {activeSection === "ai"
                ? "修改后记得保存；各模型可在上方区块内单独验证连通性。"
                : activeSection === "wechat"
                  ? "修改配置后记得保存。微信凭证可在上方卡片内验证连通性。"
                  : activeSection === "blog"
                    ? "修改配置后记得保存。博客仓库与 Token 可在上方卡片内验证连通性。"
                    : "修改配置后记得保存。"}
            </p>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm settings-footer-save">
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
    </>
  );
}
