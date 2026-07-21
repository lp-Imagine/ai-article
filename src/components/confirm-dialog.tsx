"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
    >
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog-body">
          <p className="confirm-dialog-eyebrow">请确认</p>
          <h2 id="confirm-dialog-title" className="confirm-dialog-title">
            {title}
          </h2>
          {description ? <p className="confirm-dialog-desc">{description}</p> : null}
        </div>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary confirm-dialog-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-dialog-btn confirm-dialog-btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
