"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

export type FloatEdge = "left" | "right" | "top" | "bottom";

export type FloatPlacement = {
  edge: FloatEdge;
  /** left/right 边：距顶部的 px；top/bottom 边：距左侧的 px */
  offsetPx: number;
};

type DragPoint = { x: number; y: number };

type ViewportBounds = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const STORAGE_KEY = "mp-background-task-float-placement";
const EDGE_MARGIN = 10;
const DRAG_THRESHOLD = 5;
const DESKTOP_BOTTOM_INSET = 28;

function isElementVisible(el: HTMLElement) {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getFloatViewportBounds(): ViewportBounds {
  const bounds: ViewportBounds = {
    top: EDGE_MARGIN,
    right: EDGE_MARGIN,
    bottom: EDGE_MARGIN,
    left: EDGE_MARGIN,
  };
  if (typeof window === "undefined") return bounds;

  const isMobile = window.innerWidth < 1024;
  if (isMobile) {
    const header = document.querySelector<HTMLElement>(".app-mobile-header");
    if (header && isElementVisible(header)) {
      bounds.top = Math.max(bounds.top, header.getBoundingClientRect().bottom + EDGE_MARGIN);
    }
  }

  const bottomNav = document.querySelector<HTMLElement>(".app-mobile-bottom-nav");
  if (bottomNav && isElementVisible(bottomNav)) {
    const rect = bottomNav.getBoundingClientRect();
    bounds.bottom = Math.max(bounds.bottom, window.innerHeight - rect.top + EDGE_MARGIN);
  }

  const editorDock = document.querySelector<HTMLElement>(".mobile-editor-dock");
  if (editorDock && isElementVisible(editorDock)) {
    const rect = editorDock.getBoundingClientRect();
    bounds.bottom = Math.max(bounds.bottom, window.innerHeight - rect.top + EDGE_MARGIN);
  }

  if (!isMobile && bounds.bottom === EDGE_MARGIN) {
    bounds.bottom = DESKTOP_BOTTOM_INSET;
  }

  return bounds;
}

function bottomInset() {
  if (typeof window === "undefined") return DESKTOP_BOTTOM_INSET;
  return getFloatViewportBounds().bottom;
}

function readPlacement(): FloatPlacement | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FloatPlacement;
    if (!parsed?.edge || typeof parsed.offsetPx !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePlacement(placement: FloatPlacement) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(placement));
  } catch {
    // ignore quota errors
  }
}

function nearestEdge(x: number, y: number, vw: number, vh: number): FloatEdge {
  const bounds = getFloatViewportBounds();
  const distances: Array<[FloatEdge, number]> = [
    ["left", x - bounds.left],
    ["right", vw - bounds.right - x],
    ["top", y - bounds.top],
    ["bottom", vh - bounds.bottom - y],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

function clampOffset(
  edge: FloatEdge,
  offsetPx: number,
  width: number,
  height: number,
): number {
  if (typeof window === "undefined") return offsetPx;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bounds = getFloatViewportBounds();
  if (edge === "left" || edge === "right") {
    const min = bounds.top;
    const max = Math.max(min, vh - bounds.bottom - height);
    return Math.min(Math.max(offsetPx, min), max);
  }
  const min = bounds.left;
  const max = Math.max(min, vw - bounds.right - width);
  return Math.min(Math.max(offsetPx, min), max);
}

function clampFreePosition(x: number, y: number, width: number, height: number): DragPoint {
  if (typeof window === "undefined") return { x, y };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bounds = getFloatViewportBounds();
  const minX = bounds.left;
  const minY = bounds.top;
  const maxX = Math.max(minX, vw - bounds.right - width);
  const maxY = Math.max(minY, vh - bounds.bottom - height);
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

function defaultPlacement(height: number): FloatPlacement {
  if (typeof window === "undefined") {
    return { edge: "right", offsetPx: EDGE_MARGIN };
  }
  const vh = window.innerHeight;
  return {
    edge: "right",
    offsetPx: clampOffset("right", vh - height - bottomInset(), height, height),
  };
}

function adjustPlacementOnSizeChange(
  placement: FloatPlacement,
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): FloatPlacement {
  let offsetPx = placement.offsetPx;
  if (placement.edge === "left" || placement.edge === "right") {
    offsetPx += oldHeight - newHeight;
  } else {
    offsetPx += oldWidth - newWidth;
  }
  return {
    edge: placement.edge,
    offsetPx: clampOffset(placement.edge, offsetPx, newWidth, newHeight),
  };
}

function placementFromFreePosition(
  point: DragPoint,
  width: number,
  height: number,
): FloatPlacement {
  const centerX = point.x + width / 2;
  const centerY = point.y + height / 2;
  const edge = nearestEdge(centerX, centerY, window.innerWidth, window.innerHeight);
  const offsetPx =
    edge === "left" || edge === "right"
      ? clampOffset(edge, point.y, width, height)
      : clampOffset(edge, point.x, width, height);
  return { edge, offsetPx };
}

function placementToStyle(placement: FloatPlacement, width: number, height: number): CSSProperties {
  const offset = clampOffset(placement.edge, placement.offsetPx, width, height);
  switch (placement.edge) {
    case "left":
      return { left: EDGE_MARGIN, top: offset, right: "auto", bottom: "auto" };
    case "right":
      return { right: EDGE_MARGIN, top: offset, left: "auto", bottom: "auto" };
    case "top":
      return { top: EDGE_MARGIN, left: offset, right: "auto", bottom: "auto" };
    case "bottom":
      return {
        bottom: bottomInset(),
        left: offset,
        right: "auto",
        top: "auto",
      };
  }
}

function getPlacementRect(
  placement: FloatPlacement,
  width: number,
  height: number,
): { top: number; left: number; bottom: number; right: number } {
  if (typeof window === "undefined") {
    return { top: 0, left: 0, bottom: height, right: width };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const offset = clampOffset(placement.edge, placement.offsetPx, width, height);
  switch (placement.edge) {
    case "left":
      return { top: offset, left: EDGE_MARGIN, bottom: offset + height, right: EDGE_MARGIN + width };
    case "right":
      return {
        top: offset,
        left: vw - EDGE_MARGIN - width,
        bottom: offset + height,
        right: vw - EDGE_MARGIN,
      };
    case "top":
      return { top: EDGE_MARGIN, left: offset, bottom: EDGE_MARGIN + height, right: offset + width };
    case "bottom":
      return {
        top: vh - bottomInset() - height,
        left: offset,
        bottom: vh - bottomInset(),
        right: offset + width,
      };
  }
}

function isPlacementWithinBounds(
  placement: FloatPlacement,
  width: number,
  height: number,
): boolean {
  if (typeof window === "undefined") return true;
  const bounds = getFloatViewportBounds();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = getPlacementRect(placement, width, height);
  return (
    rect.top >= bounds.top - 0.5 &&
    rect.left >= bounds.left - 0.5 &&
    rect.bottom <= vh - bounds.bottom + 0.5 &&
    rect.right <= vw - bounds.right + 0.5
  );
}

function normalizePlacement(
  placement: FloatPlacement,
  width: number,
  height: number,
): FloatPlacement {
  const clamped = {
    ...placement,
    offsetPx: clampOffset(placement.edge, placement.offsetPx, width, height),
  };
  if (isPlacementWithinBounds(clamped, width, height)) {
    return clamped;
  }
  return defaultPlacement(height);
}

function getViewportMode() {
  if (typeof window === "undefined") return "desktop";
  return window.innerWidth < 1024 ? "mobile" : "desktop";
}

export function useEdgeSnappedFloat(
  containerRef: RefObject<HTMLElement | null>,
  anchorRef?: RefObject<HTMLElement | null>,
) {
  const [placement, setPlacement] = useState<FloatPlacement | null>(null);
  const [dragPosition, setDragPosition] = useState<DragPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  const viewportModeRef = useRef<"mobile" | "desktop">(getViewportMode());
  const dragState = useRef({
    active: false,
    moved: false,
    suppressClick: false,
    pointerId: -1,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
  });

  const readAnchorElement = useCallback(() => {
    return anchorRef?.current ?? containerRef.current;
  }, [anchorRef, containerRef]);

  const readElementSize = useCallback(() => {
    const el = readAnchorElement();
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, [readAnchorElement]);

  const initPlacement = useCallback(() => {
    const size = readElementSize();
    if (!size) return;
    const saved = readPlacement();
    const next = saved
      ? normalizePlacement(saved, size.width, size.height)
      : defaultPlacement(size.height);
    lastSizeRef.current = size;
    setPlacement(next);
  }, [readElementSize]);

  const realignPlacement = useCallback(() => {
    if (dragState.current.active) return;
    const size = readElementSize();
    if (!size) return;

    const mode = getViewportMode();
    const modeChanged = viewportModeRef.current !== mode;
    viewportModeRef.current = mode;

    setPlacement((prev) => {
      if (!prev) return prev;
      const last = lastSizeRef.current;
      let next: FloatPlacement;

      if (modeChanged) {
        next = normalizePlacement(prev, size.width, size.height);
      } else if (last && (last.width !== size.width || last.height !== size.height)) {
        const widthDelta = Math.abs(last.width - size.width);
        const heightDelta = Math.abs(last.height - size.height);
        const minorSizeChange = widthDelta < 24 && heightDelta < 24;
        next = minorSizeChange
          ? adjustPlacementOnSizeChange(prev, last.width, last.height, size.width, size.height)
          : {
              ...prev,
              offsetPx: clampOffset(prev.edge, prev.offsetPx, size.width, size.height),
            };
        next = normalizePlacement(next, size.width, size.height);
      } else {
        next = normalizePlacement(prev, size.width, size.height);
      }

      lastSizeRef.current = size;
      if (modeChanged) {
        writePlacement(next);
      }
      return next;
    });
  }, [readElementSize]);

  useEffect(() => {
    initPlacement();

    let frame = 0;
    const scheduleRealign = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          realignPlacement();
        });
      });
    };

    window.addEventListener("resize", scheduleRealign);

    const media = window.matchMedia("(max-width: 1023px)");
    const onBreakpointChange = () => scheduleRealign();
    media.addEventListener("change", onBreakpointChange);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleRealign);
      media.removeEventListener("change", onBreakpointChange);
    };
  }, [initPlacement, realignPlacement]);

  useEffect(() => {
    const el = readAnchorElement();
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      realignPlacement();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [readAnchorElement, realignPlacement, placement?.edge]);

  const onDragPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest(".background-task-float-cancel, .background-task-float-item-cancel")) {
        return;
      }
      const el = readAnchorElement();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      dragState.current = {
        active: true,
        moved: false,
        suppressClick: false,
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        startX: event.clientX,
        startY: event.clientY,
      };
    },
    [readAnchorElement],
  );

  const followPointer = useCallback(
    (clientX: number, clientY: number) => {
      const size = readElementSize();
      if (!size) return;
      const next = clampFreePosition(
        clientX - dragState.current.offsetX,
        clientY - dragState.current.offsetY,
        size.width,
        size.height,
      );
      setDragPosition(next);
    },
    [readElementSize],
  );

  const snapToEdge = useCallback(
    (clientX: number, clientY: number, persist: boolean) => {
      const size = readElementSize();
      if (!size) return;
      const point = clampFreePosition(
        clientX - dragState.current.offsetX,
        clientY - dragState.current.offsetY,
        size.width,
        size.height,
      );
      const next = placementFromFreePosition(point, size.width, size.height);
      lastSizeRef.current = size;
      setPlacement(next);
      setDragPosition(null);
      if (persist) writePlacement(next);
    },
    [readElementSize],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const state = dragState.current;
      if (!state.active || event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!state.moved) {
        state.moved = true;
        setDragging(true);
      }
      event.preventDefault();
      followPointer(event.clientX, event.clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      const state = dragState.current;
      if (!state.active || event.pointerId !== state.pointerId) return;
      const didDrag = state.moved;
      if (didDrag) {
        snapToEdge(event.clientX, event.clientY, true);
        dragState.current.suppressClick = true;
      }
      dragState.current.active = false;
      dragState.current.moved = false;
      setDragging(false);
      setDragPosition(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [followPointer, snapToEdge]);

  const consumeDragClick = useCallback(() => {
    const suppress = dragState.current.suppressClick;
    dragState.current.suppressClick = false;
    return suppress;
  }, []);

  const size = readAnchorElement()?.getBoundingClientRect();
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;

  const positionStyle: CSSProperties = dragPosition
    ? { left: dragPosition.x, top: dragPosition.y, right: "auto", bottom: "auto" }
    : placement
      ? placementToStyle(placement, width, height)
      : { right: EDGE_MARGIN, bottom: DESKTOP_BOTTOM_INSET };

  return {
    placement,
    positionStyle,
    dragging,
    onDragPointerDown,
    consumeDragClick,
    realignPlacement,
  };
}
