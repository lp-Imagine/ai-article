"use client";

import { useEffect } from "react";

/**
 * 移动端点击/滑动时，浏览器可能已释放 pointer，但 React 仍调用 releasePointerCapture，
 * 会抛出 NotFoundError。此处做安全兜底，不影响正常交互。
 */
export function PointerCaptureGuard() {
  useEffect(() => {
    const proto = Element.prototype;
    const original = proto.releasePointerCapture;
    const patched = original as typeof original & { __mpPatched?: boolean };
    if (patched.__mpPatched) return;

    proto.releasePointerCapture = function releasePointerCaptureSafe(pointerId: number) {
      try {
        if ("hasPointerCapture" in this && !this.hasPointerCapture(pointerId)) {
          return;
        }
        original.call(this, pointerId);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) {
          throw error;
        }
      }
    };
    patched.__mpPatched = true;
  }, []);

  return null;
}
