/**
 * 章节配图 prompt 片段：buildInfographicPrompt
 *
 * 版本：v1.x（从 ai.ts 原始内联版抽取，未变更）。
 */

export const SECTION_INFOGRAPHIC_STYLE =
  "Pale-gray canvas with a faint blue wash in one corner. A row of rounded white boxes, each with a distinct geometric icon. Behind the row, two or three large translucent blue circles overlapping at low opacity for atmosphere.";

export const SECTION_COLOR_ROLES =
  "White boxes, charcoal Chinese text, one restrained blue accent on the result box and on a thin connector line under the row.";

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

export function buildInfographicPrompt(
  story: SectionStoryboard,
  layout: string,
  sectionIndex: number,
  totalSections: number,
): string {
  const boxLines = story.panels
    .map((p, i) => {
      const extra = p.caption ? ` and smaller 「${p.caption}」` : "";
      return `Box ${i + 1}: Chinese 「${p.label}」${extra}; draw ${p.visual}.`;
    })
    .join(" ");

  return [
    SECTION_INFOGRAPHIC_STYLE,
    SECTION_COLOR_ROLES,
    `Arrangement: ${layout}.`,
    `This is illustration ${sectionIndex + 1} of ${totalSections}.`,
    `Top-left Chinese title exactly 「${story.title}」.`,
    boxLines,
    `Under the boxes, a thin blue line with Chinese 「${story.summary}」.`,
    "The only lettering is the Chinese strings in quotes. Do not paint English words, watermarks, page numbers, or placeholder X marks.",
    "No graph-paper grid, no colored rectangles clipped at the edges, no cute doodles.",
  ].join(" ");
}
