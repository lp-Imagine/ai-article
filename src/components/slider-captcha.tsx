"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, ChevronRight, RefreshCw, ShieldCheck, X } from "lucide-react";
import clsx from "clsx";

type Props = {
  verified: boolean;
  onVerifiedChange: (verified: boolean) => void;
  resetSignal?: number;
};

const PIECE = 44;
const RADIUS = 9;
const TOLERANCE = 8;
const THUMB = 40;
const PIECE_PAD = 14;

type PuzzleShape =
  | "jigsaw-tr"
  | "jigsaw-lb"
  | "jigsaw-top"
  | "jigsaw-right"
  | "circle"
  | "rounded-square"
  | "hexagon"
  | "soft-diamond"
  | "cloud"
  | "arrow";

const SHAPES: PuzzleShape[] = [
  "jigsaw-tr",
  "jigsaw-lb",
  "jigsaw-top",
  "jigsaw-right",
  "circle",
  "rounded-square",
  "hexagon",
  "soft-diamond",
  "cloud",
  "arrow",
];

function shapeFromSeed(seed: number): PuzzleShape {
  return SHAPES[seed % SHAPES.length];
}

function puzzlePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: PuzzleShape,
) {
  const bump = size * 0.22;
  const r = Math.min(RADIUS, size * 0.2);

  ctx.beginPath();

  if (shape === "circle") {
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }

  if (shape === "rounded-square") {
    const rr = size * 0.22;
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + size - rr, y);
    ctx.quadraticCurveTo(x + size, y, x + size, y + rr);
    ctx.lineTo(x + size, y + size - rr);
    ctx.quadraticCurveTo(x + size, y + size, x + size - rr, y + size);
    ctx.lineTo(x + rr, y + size);
    ctx.quadraticCurveTo(x, y + size, x, y + size - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    return;
  }

  if (shape === "hexagon") {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const radius = size / 2;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = cx + radius * Math.cos(a);
      const py = cy + radius * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    return;
  }

  if (shape === "soft-diamond") {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const rx = size * 0.48;
    const ry = size * 0.5;
    ctx.moveTo(cx, cy - ry);
    ctx.quadraticCurveTo(cx + rx * 0.2, cy - ry * 0.2, cx + rx, cy);
    ctx.quadraticCurveTo(cx + rx * 0.2, cy + ry * 0.2, cx, cy + ry);
    ctx.quadraticCurveTo(cx - rx * 0.2, cy + ry * 0.2, cx - rx, cy);
    ctx.quadraticCurveTo(cx - rx * 0.2, cy - ry * 0.2, cx, cy - ry);
    ctx.closePath();
    return;
  }

  if (shape === "cloud") {
    const cx = x + size / 2;
    const cy = y + size / 2;
    ctx.arc(cx - size * 0.18, cy + size * 0.04, size * 0.24, 0, Math.PI * 2);
    ctx.arc(cx + size * 0.16, cy + size * 0.06, size * 0.22, 0, Math.PI * 2);
    ctx.arc(cx, cy - size * 0.12, size * 0.26, 0, Math.PI * 2);
    ctx.arc(cx, cy + size * 0.1, size * 0.28, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }

  if (shape === "arrow") {
    ctx.moveTo(x + size * 0.12, y + size * 0.2);
    ctx.lineTo(x + size * 0.55, y + size * 0.2);
    ctx.lineTo(x + size * 0.55, y);
    ctx.lineTo(x + size * 0.92, y + size * 0.5);
    ctx.lineTo(x + size * 0.55, y + size);
    ctx.lineTo(x + size * 0.55, y + size * 0.8);
    ctx.lineTo(x + size * 0.12, y + size * 0.8);
    ctx.closePath();
    return;
  }

  // jigsaw family
  const topTab = shape === "jigsaw-tr" || shape === "jigsaw-top";
  const rightTab = shape === "jigsaw-tr" || shape === "jigsaw-right";
  const bottomTab = shape === "jigsaw-lb";
  const leftTab = shape === "jigsaw-lb";

  ctx.moveTo(x + r, y);
  if (topTab) {
    ctx.lineTo(x + size * 0.35, y);
    ctx.bezierCurveTo(x + size * 0.35, y - bump, x + size * 0.65, y - bump, x + size * 0.65, y);
  }
  ctx.lineTo(x + size - r, y);
  ctx.quadraticCurveTo(x + size, y, x + size, y + r);

  if (rightTab) {
    ctx.lineTo(x + size, y + size * 0.35);
    ctx.bezierCurveTo(
      x + size + bump,
      y + size * 0.35,
      x + size + bump,
      y + size * 0.65,
      x + size,
      y + size * 0.65,
    );
  }
  ctx.lineTo(x + size, y + size - r);
  ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);

  if (bottomTab) {
    ctx.lineTo(x + size * 0.65, y + size);
    ctx.bezierCurveTo(
      x + size * 0.65,
      y + size + bump,
      x + size * 0.35,
      y + size + bump,
      x + size * 0.35,
      y + size,
    );
  }
  ctx.lineTo(x + r, y + size);
  ctx.quadraticCurveTo(x, y + size, x, y + size - r);

  if (leftTab) {
    ctx.lineTo(x, y + size * 0.65);
    ctx.bezierCurveTo(
      x - bump,
      y + size * 0.65,
      x - bump,
      y + size * 0.35,
      x,
      y + size * 0.35,
    );
  }
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function randomTarget(width: number, seed: number) {
  const min = 52;
  const max = Math.max(min + 8, width - PIECE - 20);
  return min + ((seed * 97) % Math.max(1, max - min));
}

function randomPieceY(height: number, seed: number) {
  const min = Math.round(height * 0.22);
  const max = Math.round(height * 0.48);
  return min + rand(seed, 17, Math.max(1, max - min));
}

type Theme = {
  id: string;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) => void;
};

function rand(seed: number, i: number, mod: number) {
  return Math.abs((seed * 9301 + i * 49297) % 233280) % Math.max(1, mod);
}

function drawNightOrbs(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) {
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, "#1a2a44");
  g.addColorStop(0.5, "#16345c");
  g.addColorStop(1, "#0f2748");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 18; i++) {
    const x = rand(seed, i + 3, width);
    const y = rand(seed, i + 9, height);
    const r = 16 + rand(seed, i, 40);
    const orb = ctx.createRadialGradient(x, y, 0, x, y, r);
    orb.addColorStop(0, `rgba(71, 161, 255, ${0.16 + rand(seed, i, 5) * 0.03})`);
    orb.addColorStop(1, "rgba(71, 161, 255, 0)");
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSunriseHills(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#ffd7a8");
  sky.addColorStop(0.45, "#ffb38a");
  sky.addColorStop(1, "#7eb8e8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const sunX = width * (0.62 + rand(seed, 1, 20) / 100);
  const sunY = height * 0.34;
  const sun = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 48);
  sun.addColorStop(0, "rgba(255, 248, 220, 0.95)");
  sun.addColorStop(1, "rgba(255, 180, 90, 0)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 48, 0, Math.PI * 2);
  ctx.fill();

  for (let layer = 0; layer < 3; layer++) {
    const baseY = height * (0.55 + layer * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, baseY);
    for (let x = 0; x <= width; x += 18) {
      const wave = Math.sin((x + seed + layer * 40) / (28 + layer * 8)) * (10 + layer * 4);
      ctx.lineTo(x, baseY + wave);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = ["#5f8f6b", "#3f6f58", "#2b5344"][layer];
    ctx.fill();
  }
}

function drawGeoMosaic(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) {
  const palette = ["#0ea5e9", "#0369a1", "#38bdf8", "#075985", "#7dd3fc", "#0284c7"];
  const cell = 28;
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const idx = rand(seed, x * 13 + y * 7, palette.length);
      ctx.fillStyle = palette[idx];
      ctx.fillRect(x, y, cell + 1, cell + 1);
      if (rand(seed, x + y, 3) === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + cell, y);
        ctx.lineTo(x, y + cell);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function drawOceanWaves(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, "#0b3d5c");
  g.addColorStop(1, "#06263a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    const y0 = 18 + i * 18 + rand(seed, i, 8);
    ctx.moveTo(0, y0);
    for (let x = 0; x <= width; x += 12) {
      const y = y0 + Math.sin((x + seed * 0.2 + i * 30) / 18) * (6 + (i % 3) * 2);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.12 + (i % 4) * 0.05})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (let i = 0; i < 12; i++) {
    const x = rand(seed, i + 2, width);
    const y = rand(seed, i + 5, height);
    ctx.fillStyle = "rgba(186, 230, 253, 0.35)";
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + rand(seed, i, 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPaperInk(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) {
  ctx.fillStyle = "#f4efe6";
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(40, 40, 40, ${0.02 + rand(seed, i, 4) * 0.01})`;
    ctx.fillRect(rand(seed, i, width), rand(seed, i + 3, height), 1, 1);
  }

  for (let i = 0; i < 5; i++) {
    const x = 30 + rand(seed, i * 4, width - 60);
    const y = 24 + rand(seed, i * 5, height - 50);
    ctx.strokeStyle = `rgba(30, 41, 59, ${0.18 + i * 0.05})`;
    ctx.lineWidth = 1.5 + (i % 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let t = 0; t < 5; t++) {
      ctx.quadraticCurveTo(
        x + 20 + t * 16,
        y + (rand(seed, i + t, 30) - 15),
        x + 40 + t * 16,
        y + (rand(seed, i + t + 2, 24) - 12),
      );
    }
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(15, 23, 42, 0.08)";
  ctx.fillRect(0, height - 18, width, 18);
}

function drawNeonGrid(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) {
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, "#12081f");
  g.addColorStop(1, "#1b1035");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(168, 85, 247, 0.18)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  for (let i = 0; i < 10; i++) {
    const x = rand(seed, i, width);
    const y = rand(seed, i + 8, height);
    const r = 10 + rand(seed, i, 24);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, "rgba(34, 211, 238, 0.45)");
    glow.addColorStop(1, "rgba(34, 211, 238, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawForestMist(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, "#dcefe4");
  g.addColorStop(1, "#8fb39a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 14; i++) {
    const x = rand(seed, i, width);
    const h = 40 + rand(seed, i + 2, height * 0.55);
    ctx.fillStyle = `rgba(47, 79, 58, ${0.18 + rand(seed, i, 4) * 0.05})`;
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x - 12 - rand(seed, i, 10), height);
    ctx.lineTo(x, height - h);
    ctx.lineTo(x + 12 + rand(seed, i + 1, 10), height);
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 6; i++) {
    const x = rand(seed, i + 20, width);
    const y = rand(seed, i + 21, height);
    const mist = ctx.createRadialGradient(x, y, 0, x, y, 36);
    mist.addColorStop(0, "rgba(255,255,255,0.35)");
    mist.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = mist;
    ctx.beginPath();
    ctx.arc(x, y, 36, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCandyBubbles(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number) {
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, "#ffe4ec");
  g.addColorStop(1, "#e0f2fe");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  const colors = [
    "rgba(244, 114, 182, 0.35)",
    "rgba(56, 189, 248, 0.35)",
    "rgba(251, 191, 36, 0.35)",
    "rgba(129, 140, 248, 0.35)",
  ];
  for (let i = 0; i < 16; i++) {
    const x = rand(seed, i, width);
    const y = rand(seed, i + 4, height);
    const r = 10 + rand(seed, i + 6, 28);
    ctx.fillStyle = colors[rand(seed, i, colors.length)];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
}

const THEMES: Theme[] = [
  { id: "night-orbs", draw: drawNightOrbs },
  { id: "sunrise-hills", draw: drawSunriseHills },
  { id: "geo-mosaic", draw: drawGeoMosaic },
  { id: "ocean-waves", draw: drawOceanWaves },
  { id: "paper-ink", draw: drawPaperInk },
  { id: "neon-grid", draw: drawNeonGrid },
  { id: "forest-mist", draw: drawForestMist },
  { id: "candy-bubbles", draw: drawCandyBubbles },
];

function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
) {
  const theme = THEMES[seed % THEMES.length];
  theme.draw(ctx, width, height, seed);

  ctx.fillStyle =
    theme.id === "paper-ink" || theme.id === "candy-bubbles" || theme.id === "sunrise-hills" || theme.id === "forest-mist"
      ? "rgba(15, 23, 42, 0.28)"
      : "rgba(255,255,255,0.14)";
  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Draftly", 14, 24);
}

function PuzzlePanel({ onSuccess }: { onSuccess: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLCanvasElement>(null);
  const pieceRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const passedRef = useRef(false);
  const offsetRef = useRef(0);
  const maxOffsetRef = useRef(0);
  const boardWidthRef = useRef(320);
  const targetXRef = useRef(80);
  const onSuccessRef = useRef(onSuccess);

  const [seed, setSeed] = useState(() => Date.now() % 100000);
  const [offset, setOffset] = useState(0);
  const [maxOffset, setMaxOffset] = useState(0);
  const [failed, setFailed] = useState(false);
  const [passed, setPassed] = useState(false);
  const [boardSize, setBoardSize] = useState({ w: 320, h: 160 });

  const targetX = useMemo(() => randomTarget(boardSize.w, seed), [boardSize.w, seed]);
  const pieceY = useMemo(() => randomPieceY(boardSize.h, seed), [boardSize.h, seed]);
  const shape = useMemo(() => shapeFromSeed(seed), [seed]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    passedRef.current = passed;
  }, [passed]);

  useEffect(() => {
    boardWidthRef.current = boardSize.w;
  }, [boardSize.w]);

  useEffect(() => {
    targetXRef.current = targetX;
  }, [targetX]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track) return;
    const w = Math.max(240, Math.floor(root.clientWidth));
    const h = Math.round(Math.min(176, Math.max(148, w * 0.48)));
    setBoardSize({ w, h });
    boardWidthRef.current = w;
    const nextMax = Math.max(0, Math.floor(track.clientWidth - THUMB - 4));
    setMaxOffset(nextMax);
    maxOffsetRef.current = nextMax;
  }, []);

  useEffect(() => {
    measure();
    const id = window.requestAnimationFrame(measure);
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    if (track) observer.observe(track);
    return () => {
      window.cancelAnimationFrame(id);
      observer.disconnect();
    };
  }, [measure]);

  const rebuild = useCallback(() => {
    setSeed((prev) => {
      let next = (Date.now() + Math.floor(Math.random() * 1000)) % 100000;
      // 同时换背景主题和拼图形状
      while (
        next % THEMES.length === prev % THEMES.length ||
        next % SHAPES.length === prev % SHAPES.length
      ) {
        next += 1;
      }
      return next;
    });
    setOffset(0);
    offsetRef.current = 0;
    setFailed(false);
    setPassed(false);
    passedRef.current = false;
    draggingRef.current = false;
    window.requestAnimationFrame(measure);
  }, [measure]);

  useEffect(() => {
    const board = boardRef.current;
    const piece = pieceRef.current;
    if (!board) return;

    board.width = boardSize.w;
    board.height = boardSize.h;
    const bctx = board.getContext("2d");
    if (!bctx) return;

    drawBackground(bctx, boardSize.w, boardSize.h, seed);

    if (!passed) {
      bctx.save();
      puzzlePath(bctx, targetX, pieceY, PIECE, shape);
      bctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      bctx.fill();
      bctx.strokeStyle = "rgba(255,255,255,0.2)";
      bctx.lineWidth = 1.5;
      bctx.stroke();
      bctx.restore();
    }

    if (!piece || passed) return;

    piece.width = PIECE + PIECE_PAD * 2;
    piece.height = PIECE + PIECE_PAD * 2;
    const pctx = piece.getContext("2d");
    if (!pctx) return;

    const off = document.createElement("canvas");
    off.width = boardSize.w;
    off.height = boardSize.h;
    const octx = off.getContext("2d");
    if (!octx) return;
    drawBackground(octx, boardSize.w, boardSize.h, seed);

    pctx.clearRect(0, 0, piece.width, piece.height);
    pctx.save();
    puzzlePath(pctx, PIECE_PAD, PIECE_PAD, PIECE, shape);
    pctx.clip();
    pctx.drawImage(
      off,
      targetX - PIECE_PAD,
      pieceY - PIECE_PAD,
      piece.width,
      piece.height,
      0,
      0,
      piece.width,
      piece.height,
    );
    pctx.restore();

    pctx.save();
    puzzlePath(pctx, PIECE_PAD, PIECE_PAD, PIECE, shape);
    pctx.lineWidth = 2;
    pctx.strokeStyle = "rgba(255,255,255,0.9)";
    pctx.stroke();
    pctx.restore();
  }, [boardSize, seed, targetX, pieceY, passed, shape]);

  const moveToClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const max = Math.max(0, rect.width - THUMB - 4);
    maxOffsetRef.current = max;
    if (max !== maxOffset) setMaxOffset(max);
    const next = Math.min(max, Math.max(0, clientX - rect.left - THUMB / 2));
    offsetRef.current = next;
    setOffset(next);
    setFailed(false);
  }, [maxOffset]);

  const finishDrag = useCallback(() => {
    if (!draggingRef.current || passedRef.current) return;
    draggingRef.current = false;

    const currentOffset = offsetRef.current;
    const currentMax = maxOffsetRef.current;
    const width = boardWidthRef.current;
    const target = targetXRef.current;
    const ratio = currentMax > 0 ? currentOffset / currentMax : 0;
    const currentX = ratio * (width - PIECE);
    const ok = Math.abs(currentX - target) <= TOLERANCE;

    if (ok) {
      setFailed(false);
      const exact = currentMax > 0 ? (target / (width - PIECE)) * currentMax : 0;
      setOffset(exact);
      offsetRef.current = exact;
      setPassed(true);
      passedRef.current = true;
      window.setTimeout(() => onSuccessRef.current(), 360);
      return;
    }

    setFailed(true);
    // 失败后自动更换一张新拼图（位置/形状/背景都会变），避免同一张反复试
    window.setTimeout(() => {
      rebuild();
    }, 420);
  }, [rebuild]);

  function onThumbPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (passedRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    moveToClientX(event.clientX);
  }

  function onThumbPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingRef.current || passedRef.current) return;
    event.preventDefault();
    moveToClientX(event.clientX);
  }

  function onThumbPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingRef.current) return;
    event.preventDefault();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }
    finishDrag();
  }

  function onTrackPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (passedRef.current) return;
    if ((event.target as HTMLElement).closest(".slider-captcha-thumb")) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    moveToClientX(event.clientX);
  }

  function onTrackPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || passedRef.current) return;
    if ((event.target as HTMLElement).closest(".slider-captcha-thumb")) return;
    event.preventDefault();
    moveToClientX(event.clientX);
  }

  const progress = maxOffset > 0 ? offset / maxOffset : 0;
  const pieceLeft = progress * (boardSize.w - PIECE);

  return (
    <div
      ref={rootRef}
      className={clsx("puzzle-captcha", failed && "puzzle-captcha-failed")}
    >
      <div className="puzzle-captcha-board-wrap">
        <canvas ref={boardRef} className="puzzle-captcha-board" />
        {!passed ? (
          <canvas
            ref={pieceRef}
            className="puzzle-captcha-piece"
            style={{
              left: pieceLeft - PIECE_PAD,
              top: pieceY - PIECE_PAD,
            }}
          />
        ) : null}
        {passed ? (
          <div className="puzzle-captcha-ok-mask">
            <Check size={16} strokeWidth={2.4} />
            验证通过
          </div>
        ) : null}
        <button
          type="button"
          className="puzzle-captcha-refresh"
          onClick={rebuild}
          aria-label="刷新验证码"
          disabled={passed}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div
        ref={trackRef}
        className={clsx("slider-captcha-track", passed && "slider-captcha-track-ok")}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onThumbPointerUp}
        onPointerCancel={onThumbPointerUp}
      >
        <div
          className="slider-captcha-fill"
          style={{ width: passed ? "100%" : `${Math.max(progress * 100, 0)}%` }}
        />
        <span className="slider-captcha-hint">
          {passed ? "验证通过" : "拖动滑块，将拼图拖到缺口处"}
        </span>
        <button
          type="button"
          className={clsx("slider-captcha-thumb", passed && "slider-captcha-thumb-ok")}
          style={{ transform: `translate3d(${passed ? maxOffset : offset}px, 0, 0)` }}
          onPointerDown={onThumbPointerDown}
          onPointerMove={onThumbPointerMove}
          onPointerUp={onThumbPointerUp}
          onPointerCancel={onThumbPointerUp}
          aria-label={passed ? "已通过拼图验证" : "拖动拼图滑块"}
          disabled={passed}
        >
          {passed ? <Check size={18} strokeWidth={2.4} /> : <ChevronRight size={18} strokeWidth={2.4} />}
        </button>
      </div>
    </div>
  );
}

export function SliderCaptcha({ verified, onVerifiedChange, resetSignal = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const onVerifiedChangeRef = useRef(onVerifiedChange);

  useEffect(() => {
    onVerifiedChangeRef.current = onVerifiedChange;
  }, [onVerifiedChange]);

  useEffect(() => {
    setOpen(false);
    onVerifiedChangeRef.current(false);
  }, [resetSignal]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  function handleSuccess() {
    onVerifiedChange(true);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className={clsx("captcha-trigger", verified && "captcha-trigger-ok")}
        onClick={() => {
          if (verified) return;
          setOpen(true);
        }}
        aria-expanded={open}
      >
        <span className="captcha-trigger-icon">
          {verified ? <Check size={16} strokeWidth={2.4} /> : <ShieldCheck size={16} strokeWidth={2.1} />}
        </span>
        <span className="captcha-trigger-text">
          {verified ? "验证成功" : "点击按钮进行验证"}
        </span>
        {!verified ? <ChevronRight size={16} className="captcha-trigger-arrow" /> : null}
      </button>

      {open ? (
        <div
          className="puzzle-modal-overlay"
          role="presentation"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="puzzle-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="puzzle-modal-title"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <header className="puzzle-modal-header">
              <div>
                <p className="puzzle-modal-eyebrow">安全验证</p>
                <h3 id="puzzle-modal-title" className="puzzle-modal-title">
                  请完成拼图验证
                </h3>
              </div>
              <button
                type="button"
                className="puzzle-modal-close"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </header>
            <div className="puzzle-modal-body">
              <PuzzlePanel onSuccess={handleSuccess} />
            </div>
            <p className="puzzle-modal-tip">拖动下方滑块，使拼图块与缺口重合</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
