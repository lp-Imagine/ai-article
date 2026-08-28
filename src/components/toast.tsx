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

/** Stable toast API for consumers — excludes `toasts` so show() won't invalidate callbacks. */
type ToastApi = {
  show: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  update: (id: string, patch: Partial<ToastInput>) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_ICONS: Record<ToastVariant, string> = {
  success: "✓",
  error: "✕",
  info: "ⓘ",
  warning: "!",
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
    <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className={`toast-item toast-item-${toast.variant}`}
        >
          <span
            className={`toast-item-icon toast-item-icon-${toast.variant}`}
            aria-hidden
          >
            {VARIANT_ICONS[toast.variant]}
          </span>
          <div className="toast-item-body">
            {toast.title ? <p className="toast-item-title">{toast.title}</p> : null}
            <p className="toast-item-message">{toast.message}</p>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action!.onClick();
                  onDismiss(toast.id);
                }}
                className="toast-item-action"
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="关闭"
            className="toast-item-close"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return useMemo(
    () => ({
      show: ctx.show,
      dismiss: ctx.dismiss,
      update: ctx.update,
    }),
    [ctx.show, ctx.dismiss, ctx.update],
  );
}
