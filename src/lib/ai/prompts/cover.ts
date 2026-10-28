/**
 * 章节配图 prompt 片段
 *
 * 版本：v6 — 与封面同画幅观感；场景填满中景避免空洞；
 * 可选短标签三卡，但仍禁止半截字/占位标题/外框阴影。
 */

/** 场景版式：单隐喻 | 前后对比 | 短标签三卡 | 三图标无字 */
export type SectionSceneMode = "hero" | "duo" | "trio-short" | "trio-icons";

export type SectionStoryBeat = {
  /** 英文软 3D 物体描述 */
  visual: string;
  /** 可选极短完整中文（2-4 字），仅 trio-short / duo 使用 */
  label?: string;
};

export type SectionStoryboard = {
  /** 仅供分镜，绝不画进图 */
  title: string;
  mode: SectionSceneMode;
  /** 英文场景描述（黏土物体、构图、情绪） */
  scene: string;
  /** 底部一句完整总结 */
  summary: string;
  beats: SectionStoryBeat[];
};

/** @deprecated 兼容旧 panel 形态；新分镜请用 SectionStoryBeat */
export type SectionStoryPanel = {
  role: "cause" | "step" | "flaw" | "result";
  label: string;
  caption: string;
  visual: string;
};

export const SECTION_CLAY_STYLE =
  "Wide 16:9 landscape soft claymorphism illustration, same banner proportions as an article cover. " +
  "Warm cream or soft ivory canvas. Soft studio light, gentle contact shadows under objects only. " +
  "Matte toy-like clay forms with peach-orange and calm sky-blue accents. " +
  "Fill the middle of the frame — the main clay subject should occupy most of the width and feel substantial, not a tiny island in empty space.";

export const SECTION_RENDER_GUARDS = [
  "Keep a modest margin (~5%) so nothing is cropped, but do NOT leave large empty left/right voids.",
  "Do NOT paint any separate title plaque, corner headline, or 「标题设计」/Title/Untitled.",
  "Forbidden: graph-paper, torn paper, sticky notes, smile stickers, brand logos, glossy speech-bubble UI, English tooltips like Query/Prompt Template.",
  "No dark charcoal outer frame, no floating card mockup, no drop-shadow silhouette around the whole artwork — paint full-bleed on the cream canvas.",
  "Chinese on the image must be COMPLETE short phrases only — never truncated mid-word, never stacked nonsense like 词词.",
  "No neon cyberpunk, no dark space background, no microscopic glyphs.",
].join(" ");

/**
 * 按「显示单元」截断：连续拉丁/数字算 1 格，每个汉字算 1 格。
 */
export function softClipLabel(text: string, maxUnits: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || maxUnits <= 0) return "";

  const tokens: string[] = [];
  const re = /[A-Za-z0-9][A-Za-z0-9.+#_%→\-]*|[\u4e00-\u9fff]|./gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(t))) {
    tokens.push(match[0]);
  }
  if (tokens.length <= maxUnits) return t;

  return tokens
    .slice(0, maxUnits)
    .join("")
    .replace(/[，,。.!！？、：:\-–—]+$/u, "")
    .trim();
}

/** 底部总结：宁可短而完整，避免半截词 */
export function fitSectionSummary(text: string, maxUnits = 10): string {
  const cleaned = text
    .replace(/[【】\[\]「」""''{}]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return "本章要点";
  const clipped = softClipLabel(cleaned, maxUnits);
  if (/(.)\1{2,}/u.test(clipped) || /词词|案案/.test(clipped)) {
    return "要点对照";
  }
  return clipped || "本章要点";
}

/** 物体短标签：2-4 字完整词，过长或半截则放弃（宁可不画） */
export function fitBeatLabel(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, "").trim();
  if (cleaned.length < 2) return undefined;
  const clipped = softClipLabel(cleaned, 4);
  if (!clipped || clipped.length < 2) return undefined;
  if (/(.)\1{2,}/u.test(clipped) || /词词|案案|标题/.test(clipped)) return undefined;
  return clipped;
}

function layoutHint(mode: SectionSceneMode): string {
  switch (mode) {
    case "duo":
      return (
        "Composition: TWO large soft clay objects side by side filling most of the frame (before → after). " +
        "A thin soft arrow between them. Optional 2-4 character Chinese label under each object if provided. No long captions."
      );
    case "trio-short":
      return (
        "Composition: THREE equal soft clay rounded cards in a tight row filling most of the width. " +
        "Each card has one icon and one SHORT Chinese label (2-4 chars) if provided — no second caption line. Soft connector under the row."
      );
    case "trio-icons":
      return (
        "Composition: THREE medium soft clay icon props in a row with supporting clay base/platform so the middle of the frame feels full. " +
        "Icons only — no Chinese on the props."
      );
    case "hero":
    default:
      return (
        "Composition: ONE large central soft clay diorama / metaphor that fills most of the frame width and height. " +
        "Add 2-4 supporting clay props around it so the scene does not feel empty. No card grid. No Chinese on the props."
      );
  }
}

export function buildInfographicPrompt(
  story: SectionStoryboard,
  _layout: string,
  sectionIndex: number,
  totalSections: number,
): string {
  const summary = fitSectionSummary(story.summary, 10);
  const mode = story.mode || "hero";
  const maxBeats = mode === "duo" ? 2 : mode === "trio-short" || mode === "trio-icons" ? 3 : 3;
  const beats = story.beats.slice(0, maxBeats);
  const allowLabels = mode === "duo" || mode === "trio-short";

  const beatLine =
    beats.length > 0
      ? `Clay props: ${beats
          .map((b, i) => {
            const label = allowLabels ? fitBeatLabel(b.label) : undefined;
            return label
              ? `${i + 1}) ${b.visual}; Chinese label exactly 「${label}」`
              : `${i + 1}) ${b.visual}; no text on this prop`;
          })
          .join("; ")}.`
      : "";

  const chineseRule =
    allowLabels && beats.some((b) => fitBeatLabel(b.label))
      ? `Chinese lettering allowed: only the short prop labels above (if any) and the bottom summary 「${summary}」. Nothing else.`
      : `The ONLY Chinese lettering on the entire image is the bottom summary 「${summary}」.`;

  return [
    SECTION_CLAY_STYLE,
    layoutHint(mode),
    `This is illustration ${sectionIndex + 1} of ${totalSections}.`,
    `Scene (English, do not paint as text): ${story.scene}`,
    beatLine,
    `Bottom center: paint exactly one complete Chinese summary 「${summary}」 under a thin soft bracket line.`,
    chineseRule,
    SECTION_RENDER_GUARDS,
  ]
    .filter(Boolean)
    .join(" ");
}
