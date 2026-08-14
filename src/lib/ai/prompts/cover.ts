/**
 * 章节配图 prompt 片段：buildInfographicPrompt（依赖 ai.ts 内部 SectionStoryboard 等）
 *
 * 版本：v1.x（从 ai.ts 原始内联版抽取，未变更）。
 */
// 无外部依赖；SECTION_INFOGRAPHIC_STYLE / SECTION_COLOR_ROLES / SectionStoryboard 在 ai.ts 同模块下已声明

export const SECTION_INFOGRAPHIC_STYLE =
  "Friendly teaching comic infographic with cute simplified icons. High readability Chinese labels painted clearly and completely. One simple stick-figure without photoreal face is OK for the outcome.";

/** 章节分区用色（固定参考图配色） */
export const SECTION_COLOR_ROLES =
  "Color roles: title chip cream with brown outline; cause/left area pale sky-blue; middle mechanism boxes blush pink (top) and soft apricot (bottom); result area mint green with coral ribbon; bottom summary is a thick lavender arrow. Keep the cream-beige paper showing around all panels.";

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
  const panelLines = story.panels
    .map((p, i) => {
      const cap = p.caption ? ` caption 「${p.caption}」` : "";
      return `Panel ${i + 1} (${p.role}): label 「${p.label}」${cap}; draw ${p.visual}.`;
    })
    .join(" ");

  return [
    // lookbook 放最前，提高生图模型对颜色/背景的权重
    SECTION_INFOGRAPHIC_STYLE,
    SECTION_COLOR_ROLES,
    `Layout: ${layout}.`,
    `Section illustration ${sectionIndex + 1} of ${totalSections}.`,
    `Top-left title chip exactly 「${story.title}」 in dark brown ink on cream.`,
    panelLines,
    `Bottom thick lavender arrow with summary text exactly 「${story.summary}」.`,
    "Must feel like a warm sketchbook teaching page: latte-beige paper everywhere, pastel pink/apricot/mint blocks, brown doodle outlines. Background stays clean — no warning triangles, no scattered dots.",
    "All Chinese text must be complete — never truncate mid-phrase.",
    "FORBIDDEN: pure white studio background, cool gray wash, navy cyber background, neon glow, frosted glass, photoreal 3D, keyword chip rows.",
    "No Midjourney/SD syntax. No aspect ratio or pixel size mentions.",
  ].join(" ");
}
