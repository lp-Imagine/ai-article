"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { FieldLabel, PageHeader, SectionCard } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Schedule = {
  id: string;
  name: string;
  topicSource: "fixed" | "ideas";
  fixedTopic: string | null;
  keywords: string | null;
  style: string | null;
  wordCount: number | null;
  audience: string | null;
  goal: string | null;
  autoPush: boolean;
  scheduleType: "daily" | "weekly" | "interval_hours";
  hour: number;
  minute: number;
  weekday: number | null;
  intervalHours: number | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastArticleId: string | null;
  lastError: string | null;
  runCount: number;
  createdAt: string;
};

type ApiResponse<T> = { code: number; message: string; data: T };

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const STYLE_OPTIONS = ["干货型", "观点型", "故事型", "清单型", "深度分析"];
const GOAL_OPTIONS = ["知识分享", "产品推广", "品牌宣传", "引流获客", "行业观点"];

type FormState = {
  name: string;
  topicSource: "fixed" | "ideas";
  fixedTopic: string;
  scheduleType: "daily" | "weekly" | "interval_hours";
  hour: number;
  minute: number;
  weekday: number;
  intervalHours: number;
  autoPush: boolean;
  keywords: string;
  style: string;
  wordCount: number;
  audience: string;
  goal: string;
};

const DEFAULT_FORM: FormState = {
  name: "",
  topicSource: "fixed",
  fixedTopic: "",
  scheduleType: "daily",
  hour: 9,
  minute: 0,
  weekday: 1,
  intervalHours: 24,
  autoPush: false,
  keywords: "",
  style: "干货型",
  wordCount: 1200,
  audience: "",
  goal: "知识分享",
};

function describeSchedule(s: Schedule): string {
  const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  if (s.scheduleType === "daily") return `每天 ${time}`;
  if (s.scheduleType === "weekly") {
    return `每${WEEKDAY_LABELS[s.weekday ?? 1]} ${time}`;
  }
  return `每 ${s.intervalHours ?? "?"} 小时`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SchedulesPage() {
  const toast = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deletingSchedule, setDeletingSchedule] = useState<Schedule | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<Schedule[]>;
      if (json.code === 0) setSchedules(json.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setAdvancedOpen(false);
    setFormOpen(true);
  }

  function openEdit(s: Schedule) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      topicSource: s.topicSource,
      fixedTopic: s.fixedTopic ?? "",
      scheduleType: s.scheduleType,
      hour: s.hour,
      minute: s.minute,
      weekday: s.weekday ?? 1,
      intervalHours: s.intervalHours ?? 24,
      autoPush: s.autoPush,
      keywords: s.keywords ?? "",
      style: s.style ?? "干货型",
      wordCount: s.wordCount ?? 1200,
      audience: s.audience ?? "",
      goal: s.goal ?? "知识分享",
    });
    setAdvancedOpen(
      Boolean(s.keywords || s.audience || (s.style && s.style !== "干货型")),
    );
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!form.name.trim()) {
      toast.show({ message: "请输入任务名称", variant: "warning" });
      return;
    }
    if (form.topicSource === "fixed" && !form.fixedTopic.trim()) {
      toast.show({ message: "固定主题模式需要填写主题", variant: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        name: form.name.trim(),
        topicSource: form.topicSource,
        fixedTopic: form.topicSource === "fixed" ? form.fixedTopic.trim() : undefined,
        scheduleType: form.scheduleType,
        hour: form.hour,
        minute: form.minute,
        weekday: form.scheduleType === "weekly" ? form.weekday : undefined,
        intervalHours:
          form.scheduleType === "interval_hours" ? form.intervalHours : undefined,
        autoPush: form.autoPush,
        keywords: form.keywords || undefined,
        style: form.style || undefined,
        wordCount: form.wordCount || undefined,
        audience: form.audience || undefined,
        goal: form.goal || undefined,
        enabled: true,
      };
      const res = await fetch(
        editingId ? `/api/schedules/${editingId}` : "/api/schedules",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as ApiResponse<Schedule>;
      if (json.code !== 0) throw new Error(json.message || "保存失败");
      toast.show({
        message: editingId ? "定时任务已更新" : "定时任务已创建",
        variant: "success",
      });
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.show({
        title: "保存失败",
        message: err instanceof Error ? err.message : "保存失败",
        variant: "error",
        duration: 6000,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(s: Schedule) {
    try {
      const res = await fetch(`/api/schedules/${s.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      const json = (await res.json()) as ApiResponse<Schedule>;
      if (json.code !== 0) throw new Error(json.message || "操作失败");
      await load();
    } catch (err) {
      toast.show({
        title: "操作失败",
        message: err instanceof Error ? err.message : "操作失败",
        variant: "error",
      });
    }
  }

  async function handleDeleteConfirm() {
    const s = deletingSchedule;
    if (!s) return;
    setDeletingSchedule(null);
    try {
      const res = await fetch(`/api/schedules/${s.id}`, { method: "DELETE" });
      const json = (await res.json()) as ApiResponse<{ deleted: boolean }>;
      if (json.code !== 0) throw new Error(json.message || "删除失败");
      toast.show({ message: "已删除", variant: "success" });
      await load();
    } catch (err) {
      toast.show({
        title: "删除失败",
        message: err instanceof Error ? err.message : "删除失败",
        variant: "error",
      });
    }
  }

  async function handleRunNow(s: Schedule) {
    if (runningId) return;
    setRunningId(s.id);
    try {
      const res = await fetch(`/api/schedules/${s.id}/run`, { method: "POST" });
      const json = (await res.json()) as ApiResponse<{
        article: { id: string };
      }>;
      if (json.code !== 0) throw new Error(json.message || "执行失败");
      toast.show({
        message: "已触发一次快捷生成，可在工作台浮标或文章页查看进度",
        variant: "success",
        duration: 5000,
      });
      await load();
    } catch (err) {
      toast.show({
        title: "执行失败",
        message: err instanceof Error ? err.message : "执行失败",
        variant: "error",
        duration: 6000,
      });
    } finally {
      setRunningId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Schedule · Auto Generate"
        title="定时任务"
        description="设置主题与频率，系统到点自动完成 大纲 → 正文 →（可选）推送微信草稿，全程无需人工干预。"
        className="home-page-header"
      />

      <div className="schedules-page">
        <div className="schedules-toolbar">
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus size={16} />
            新建定时任务
          </button>
        </div>

        {formOpen ? (
          <SectionCard
            title={editingId ? "编辑定时任务" : "新建定时任务"}
            description="主题来源可选固定主题，或每次从「灵感」中自动选一个热点选题。"
            className="schedules-form-card"
          >
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="field-grid field-grid-2">
                <div>
                  <FieldLabel>任务名称</FieldLabel>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="如：每日前端热点"
                    className="mt-2 w-full px-4 py-2.5 text-sm"
                    maxLength={50}
                  />
                </div>
                <div>
                  <FieldLabel>主题来源</FieldLabel>
                  <select
                    value={form.topicSource}
                    onChange={(e) =>
                      update("topicSource", e.target.value as FormState["topicSource"])
                    }
                    className="mt-2 w-full px-4 py-2.5 text-sm"
                  >
                    <option value="fixed">固定主题</option>
                    <option value="ideas">从灵感中选（含 AI 热点）</option>
                  </select>
                </div>
              </div>

              {form.topicSource === "fixed" ? (
                <div>
                  <FieldLabel>主题</FieldLabel>
                  <input
                    type="text"
                    value={form.fixedTopic}
                    onChange={(e) => update("fixedTopic", e.target.value)}
                    placeholder="如：前端工程化实践"
                    className="mt-2 w-full px-4 py-2.5 text-sm"
                    maxLength={200}
                  />
                </div>
              ) : null}

              <div className="field-grid field-grid-2">
                <div>
                  <FieldLabel>执行频率</FieldLabel>
                  <select
                    value={form.scheduleType}
                    onChange={(e) =>
                      update(
                        "scheduleType",
                        e.target.value as FormState["scheduleType"],
                      )
                    }
                    className="mt-2 w-full px-4 py-2.5 text-sm"
                  >
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="interval_hours">每隔 N 小时</option>
                  </select>
                </div>
                {form.scheduleType === "interval_hours" ? (
                  <div>
                    <FieldLabel>间隔小时数</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={form.intervalHours}
                      onChange={(e) =>
                        update("intervalHours", Number(e.target.value) || 24)
                      }
                      className="mt-2 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                ) : (
                  <div>
                    <FieldLabel>执行时间</FieldLabel>
                    <div className="mt-2 flex items-center gap-2">
                      {form.scheduleType === "weekly" ? (
                        <select
                          value={form.weekday}
                          onChange={(e) => update("weekday", Number(e.target.value))}
                          className="px-4 py-2.5 text-sm"
                        >
                          {WEEKDAY_LABELS.map((label, i) => (
                            <option key={label} value={i}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={form.hour}
                        onChange={(e) =>
                          update("hour", Math.min(23, Math.max(0, Number(e.target.value) || 0)))
                        }
                        className="w-20 px-3 py-2.5 text-sm"
                      />
                      <span className="text-sm text-muted">时</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={form.minute}
                        onChange={(e) =>
                          update(
                            "minute",
                            Math.min(59, Math.max(0, Number(e.target.value) || 0)),
                          )
                        }
                        className="w-20 px-3 py-2.5 text-sm"
                      />
                      <span className="text-sm text-muted">分</span>
                    </div>
                  </div>
                )}
              </div>

              <label className="schedules-switch-row">
                <input
                  type="checkbox"
                  checked={form.autoPush}
                  onChange={(e) => update("autoPush", e.target.checked)}
                />
                <span>
                  生成完成后<strong>自动推送到微信草稿箱</strong>
                  <span className="schedules-switch-hint">
                    （需已在「设置 → 微信公众号」配置 App ID / Secret）
                  </span>
                </span>
              </label>

              <div>
                <button
                  type="button"
                  className="schedules-advanced-toggle"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  生成参数（可选）
                </button>
                {advancedOpen ? (
                  <div className="mt-3 space-y-5">
                    <div className="field-grid field-grid-2">
                      <div>
                        <FieldLabel>文章风格</FieldLabel>
                        <select
                          value={form.style}
                          onChange={(e) => update("style", e.target.value)}
                          className="mt-2 w-full px-4 py-2.5 text-sm"
                        >
                          {STYLE_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <FieldLabel>目标字数</FieldLabel>
                        <input
                          type="number"
                          min={300}
                          max={5000}
                          step={100}
                          value={form.wordCount}
                          onChange={(e) => update("wordCount", Number(e.target.value) || 1200)}
                          className="mt-2 w-full px-4 py-2.5 text-sm"
                        />
                      </div>
                    </div>
                    <div className="field-grid field-grid-2">
                      <div>
                        <FieldLabel>写作目标</FieldLabel>
                        <select
                          value={form.goal}
                          onChange={(e) => update("goal", e.target.value)}
                          className="mt-2 w-full px-4 py-2.5 text-sm"
                        >
                          {GOAL_OPTIONS.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <FieldLabel>目标读者</FieldLabel>
                        <input
                          type="text"
                          value={form.audience}
                          onChange={(e) => update("audience", e.target.value)}
                          placeholder="如：前端工程师"
                          className="mt-2 w-full px-4 py-2.5 text-sm"
                          maxLength={100}
                        />
                      </div>
                    </div>
                    <div>
                      <FieldLabel>关键词</FieldLabel>
                      <input
                        type="text"
                        value={form.keywords}
                        onChange={(e) => update("keywords", e.target.value)}
                        placeholder="可选，多个用逗号分隔"
                        className="mt-2 w-full px-4 py-2.5 text-sm"
                        maxLength={200}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="schedules-form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setFormOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? "保存中..." : editingId ? "保存修改" : "创建任务"}
                </button>
              </div>
            </form>
          </SectionCard>
        ) : null}

        <SectionCard
          title="任务列表"
          description="到点自动执行；也可手动「立即执行」一次（不影响原定计划）。"
          className="schedules-list-card"
        >
          {loading ? (
            <p className="text-sm text-muted">加载中...</p>
          ) : schedules.length === 0 ? (
            <div className="schedules-empty">
              <CalendarClock size={32} className="text-muted" />
              <p>还没有定时任务。点击「新建定时任务」，让文章自动生成。</p>
            </div>
          ) : (
            <ul className="schedules-list">
              {schedules.map((s) => (
                <li key={s.id} className="schedules-item">
                  <div className="schedules-item-main">
                    <div className="schedules-item-head">
                      <span className="schedules-item-name">{s.name}</span>
                      <span
                        className={`schedules-badge ${s.enabled ? "schedules-badge-on" : "schedules-badge-off"}`}
                      >
                        {s.enabled ? "运行中" : "已停用"}
                      </span>
                      {s.autoPush ? (
                        <span className="schedules-badge schedules-badge-push">自动推送</span>
                      ) : null}
                    </div>
                    <p className="schedules-item-topic">
                      {s.topicSource === "ideas"
                        ? "主题来源：从灵感中选（含 AI 热点）"
                        : `主题：${s.fixedTopic ?? "—"}`}
                    </p>
                    <div className="schedules-item-meta">
                      <span>{describeSchedule(s)}</span>
                      <span>下次执行：{formatDateTime(s.nextRunAt)}</span>
                      <span>已执行 {s.runCount} 次</span>
                      {s.lastArticleId ? (
                        <Link
                          href={`/articles/${s.lastArticleId}`}
                          className="schedules-item-link"
                        >
                          查看最近文章
                        </Link>
                      ) : null}
                    </div>
                    {s.lastError ? (
                      <p className="schedules-item-error">最近错误:{s.lastError}</p>
                    ) : null}
                  </div>
                  <div className="schedules-item-actions">
                    <button
                      type="button"
                      className="btn-secondary schedules-action-btn"
                      disabled={runningId === s.id}
                      onClick={() => void handleRunNow(s)}
                      title="立即执行一次"
                    >
                      <Play size={14} />
                      {runningId === s.id ? "执行中" : "立即执行"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary schedules-action-btn"
                      onClick={() => void handleToggle(s)}
                    >
                      {s.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary schedules-action-btn"
                      onClick={() => openEdit(s)}
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-secondary schedules-action-btn schedules-action-danger"
                      onClick={() => setDeletingSchedule(s)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <ConfirmDialog
        open={deletingSchedule !== null}
        title="删除定时任务"
        description={
          deletingSchedule
            ? `确定删除「${deletingSchedule.name}」吗？删除后不会再自动生成文章。`
            : undefined
        }
        confirmLabel="删除"
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeletingSchedule(null)}
      />
    </>
  );
}
