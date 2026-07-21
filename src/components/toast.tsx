"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export type ToastInput = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
};

type ToastItem = {
  id: string;
  title?: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  action?: ToastInput["action"];
  createdAt: number;
};

type ToastContextValue = {
  toasts: ToastItem[];
  show: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  update: (id: string, patch: Partial<ToastInput>) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { ring: string; bg: string; icon: string; badge: string }> = {
  success: {
    ring: "border-[rgba(34,197,94,0.25)]",
    bg: "bg-[rgba(255,255,255,0.88)]",
    icon: "✓",
    badge: "bg-[var(--success)] text-white",
  },
  error: {
    ring: "border-[rgba(239,68,68,0.25)]",
    bg: "bg-[rgba(255,255,255,0.88)]",
    icon: "✕",
    badge: "bg-[var(--danger)] text-white",
  },
  info: {
    ring: "border-[rgba(0,113,227,0.22)]",
    bg: "bg-[rgba(255,255,255,0.92)]",
    icon: "ⓘ",
    badge: "bg-[var(--accent)] text-white",
  },
  warning: {
    ring: "border-[rgba(245,158,11,0.25)]",
    bg: "bg-[rgba(255,255,255,0.88)]",
    icon: "!",
    badge: "bg-[var(--warning)] text-white",
  },
};

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback((toast: ToastInput): string => {
    const id = `toast-${++toastCounter}`;
    const item: ToastItem = {
      id,
      title: toast.title,
      message: toast.message,
      variant: toast.variant ?? "info",
      duration: toast.duration ?? (toast.variant === "error" ? 6000 : 3500),
      action: toast.action,
      createdAt: Date.now(),
    };
    setToasts((prev) => [...prev, item]);

    if (item.duration > 0) {
      const timer = setTimeout(() => dismiss(id), item.duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  const update = useCallback((id: string, patch: Partial<ToastInput>) => {
    setToasts((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.message !== undefined ? { message: patch.message } : {}),
              ...(patch.variant !== undefined ? { variant: patch.variant } : {}),
              ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
              ...(patch.action !== undefined ? { action: patch.action } : {}),
            }
          : t,
      ),
    );
    if (patch.duration !== undefined && patch.duration > 0) {
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => dismiss(id), patch.duration);
      timersRef.current.set(id, timer);
    }
  }, [dismiss]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ toasts, show, dismiss, update }),
    [toasts, show, dismiss, update],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-stretch gap-2 max-md:top-3 sm:top-6">
      {toasts.map((toast) => {
        const style = VARIANT_STYLES[toast.variant];
        return (
          <div
            key={toast.id}
            role="alert"
            className={`pointer-events-auto flex max-w-[min(560px,calc(100vw-2rem))] items-start gap-3 rounded-2xl px-4 py-3.5 border ${style.ring} ${style.bg} backdrop-blur-xl shadow-[var(--shadow-sm)]`}
            style={{
              animation: "toast-in 180ms ease-out",
              boxShadow: toast.variant === "success"
                ? "0 0 20px rgba(74,222,128,0.15)"
                : toast.variant === "error"
                  ? "0 0 20px rgba(248,113,113,0.15)"
                  : toast.variant === "warning"
                    ? "0 0 20px rgba(255,183,77,0.15)"
                    : "0 0 20px rgba(0,113,227,0.15)",
            }}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.badge}`}
              aria-hidden
            >
              {style.icon}
            </span>
            <div className="min-w-0 flex-1">
              {toast.title && (
                <div className="text-sm font-semibold text-[var(--foreground)]">{toast.title}</div>
              )}
              <div className="text-sm leading-relaxed text-[var(--muted)]">{toast.message}</div>
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action!.onClick();
                    onDismiss(toast.id);
                  }}
                  className="mt-2 text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭"
              className="ml-2 -mr-1 -mt-1 rounded p-1 text-[rgba(0,0,0,0.25)] hover:text-[var(--foreground)] transition-colors"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
