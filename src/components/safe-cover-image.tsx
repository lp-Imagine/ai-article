"use client";

import { useEffect, useState, type ReactNode } from "react";

type SafeCoverImageProps = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  /** 无图或加载失败时展示；默认不渲染 */
  fallback?: ReactNode;
};

/** 封面外链常会过期；失败时回退，避免浏览器裂图。 */
export function SafeCoverImage({
  src,
  alt = "",
  className,
  fallback = null,
}: SafeCoverImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
  );
}
