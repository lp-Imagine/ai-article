/**
 * 章节配图 prompt 片段
 *
 * 版本：v5 — 软 3D 黏土场景风；图上只留一句完整中文总结；
 * 版式按内容在 hero / duo / trio-icons 间切换，不再固定三块带字卡片。
 */

/** 场景版式：单隐喻 | 前后对比 | 三图标（图标无字） */
export type SectionSceneMode = "hero" | "duo" | "trio-icons";

export type SectionStoryBeat = {
  /** 英文软 3D 物体描述，画在图上但不写中文 */
  visual: string;
};

export type SectionStoryboard = {
  /** 仅供分镜，绝不画进图 */
  title: string;
  mode: SectionSceneMode;
  /** 英文场景描述（黏土物体、构图、情绪） */
  scene: string;
  /** 图上唯一中文：底部一句完整总结 */
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
  "Wide landscape soft claymorphism illustration on a warm cream or soft ivory canvas. " +
  "Gentle studio lighting, soft contact shadows, matte toy-like clay forms. " +
  "Peach-orange and calm sky-blue accents only. Clean and uncluttered.";

export const SECTION_RENDER_GUARDS = [
  "Keep generous empty margin on all four sides (at least 8%). Never crop objects or Chinese characters.",
  "Do NOT paint any title, headline, corner plaque, or topic label anywhere.",
  "Forbidden anywhere: 「标题设计」, 「标题」, 「主题」, Title, Untitled, graph-paper, torn paper, sticky notes, smile stickers, brand logos, dense UI panels.",
  "The ONLY Chinese lettering on the entire image is the one quoted summary at the bottom — paint it COMPLETE, never truncated mid-word.",
  "Do not invent extra Chinese captions on objects. Icons and clay props have NO text on them.",
  "No neon cyberpunk, no dark space background, no English slogans, no microscopic glyphs.",
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
    .replace(/[【】\[\]「」""'']/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return "本章要点";
  const clipped = softClipLabel(cleaned, maxUnits);
  // 拒绝明显半截叠字（如「词词」「词词词」）
  if (/(.)\1{2,}/u.test(clipped) || /词词/.test(clipped)) {
    return "要点对照";
  }
  return clipped || "本章要点";
}

function layoutHint(mode: SectionSceneMode): string {
  switch (mode) {
    case "duo":
      return (
        "Composition: TWO soft clay objects side by side (before → after or problem → fix). " +
        "A thin soft arrow between them. Objects carry icons only — no Chinese on the objects."
      );
    case "trio-icons":
      return (
        "Composition: THREE small soft clay icon props in a loose row (process beads). " +
        "Icons only — absolutely no Chinese labels on the props. Generous spacing."
      );
    case "hero":
    default:
      return (
        "Composition: ONE large central soft clay metaphor / diorama that expresses the section idea. " +
        "May include 1-2 tiny supporting clay props. No card grid. No Chinese on the props."
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
  const beats = story.beats.slice(0, mode === "duo" ? 2 : mode === "trio-icons" ? 3 : 2);
  const beatLine =
    beats.length > 0
      ? `Clay props (icons only, no text): ${beats
          .map((b, i) => `${i + 1}) ${b.visual}`)
          .join("; ")}.`
      : "";

  return [
    SECTION_CLAY_STYLE,
    layoutHint(mode),
    `This is illustration ${sectionIndex + 1} of ${totalSections}.`,
    `Scene (English, do not paint as text): ${story.scene}`,
    beatLine,
    `Bottom center only: paint exactly one complete Chinese summary 「${summary}」 under a thin soft bracket line.`,
    SECTION_RENDER_GUARDS,
  ]
    .filter(Boolean)
    .join(" ");
}
