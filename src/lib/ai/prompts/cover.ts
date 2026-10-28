/**
 * 章节配图 prompt 片段：buildInfographicPrompt
 *
 * 版本：v2 — 修标题截断、边裁切、叠影/鬼影卡片；默认三格横排。
 */

export const SECTION_INFOGRAPHIC_STYLE =
  "Pale cream-gray paper canvas with a soft translucent blue wash in one corner only. " +
  "A clean horizontal row of rounded white cards, each with exactly one simple geometric icon. " +
  "Behind the row, at most two large translucent blue circles at very low opacity for atmosphere — they must stay behind cards and never poke out as sharp shards.";

export const SECTION_COLOR_ROLES =
  "White cards, charcoal Chinese text, one restrained blue accent on the last card and on a thin connector line under the row.";

export const SECTION_RENDER_GUARDS = [
  "Keep a generous empty margin on all four sides (at least 8% of canvas). Never crop cards, icons, title, or Chinese characters at the edge.",
  "Each card is a SINGLE clean rounded white rectangle with ONE icon — no stacked duplicates, no ghosted layers, no torn or smeared shadows.",
  "Do not draw start/end circles, badges, or English words outside the card row (no Trigger, Result, Start, End).",
  "Every Chinese string in quotes must be painted COMPLETE and fully legible — never cut a character mid-glyph, never leave a truncated word.",
  "The only lettering is the Chinese strings in quotes. No English, watermarks, page numbers, or placeholder X marks.",
  "No graph-paper grid, no colored rectangles clipped at the edges, no cute doodles, no 3D glass.",
].join(" ");

export type SectionStoryPanel = {
  role: "cause" | "step" | "flaw" | "result";
  label: string;
  caption: string;
  visual: string;
};

export type SectionStoryboard = {
  title: string;
  panels: SectionStoryPanel[];
  summary: string;
};

/**
 * 按「显示单元」截断：连续拉丁/数字算 1 格，每个汉字算 1 格。
 * 避免把「RAG私有检索故障」裁成「RAG私有检索故」。
 */
export function softClipLabel(text: string, maxUnits: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || maxUnits <= 0) return "";

  const tokens: string[] = [];
  const re = /[A-Za-z0-9][A-Za-z0-9.+#_-]*|[\u4e00-\u9fff]|./gu;
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

export function buildInfographicPrompt(
  story: SectionStoryboard,
  layout: string,
  sectionIndex: number,
  totalSections: number,
): string {
  const panels = story.panels.slice(0, 3);
  const boxLines = panels
    .map((p, i) => {
      const extra = p.caption ? ` and smaller complete 「${p.caption}」` : "";
      return `Card ${i + 1}: Chinese 「${p.label}」${extra}; draw one simple ${p.visual}.`;
    })
    .join(" ");

  return [
    SECTION_INFOGRAPHIC_STYLE,
    SECTION_COLOR_ROLES,
    `Arrangement: ${layout}. Prefer exactly ${panels.length} cards in one row, evenly spaced, fully inside the frame.`,
    `This is illustration ${sectionIndex + 1} of ${totalSections}.`,
    `Top-left Chinese title exactly 「${story.title}」 — keep the whole title inside the frame with padding.`,
    boxLines,
    `Under the cards, a thin blue bracket line with Chinese 「${story.summary}」 centered below it.`,
    SECTION_RENDER_GUARDS,
  ].join(" ");
}
