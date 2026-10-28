/**
 * 章节配图 prompt 片段：buildInfographicPrompt
 *
 * 版本：v4 — 软 3D 黏土科技风；禁止图内总标题/占位字；默认三格横排。
 */

export const SECTION_INFOGRAPHIC_STYLE =
  "Wide landscape soft claymorphism infographic on a warm cream or soft ivory canvas. " +
  "Gentle studio lighting and soft contact shadows. " +
  "A clean horizontal row of three equal soft matte 3D rounded clay cards/blocks, each with exactly one simple embossed icon. " +
  "Optional very faint peach or sky-blue wash in one far corner — never a torn-paper title plaque.";

export const SECTION_COLOR_ROLES =
  "Cream canvas, white/soft-clay cards, charcoal Chinese text, peach-orange and calm sky-blue accents on icons and the bottom connector.";

export const SECTION_RENDER_GUARDS = [
  "Keep a generous empty margin on all four sides (at least 8% of canvas). Never crop cards, icons, or Chinese characters at the edge.",
  "Do NOT paint any separate title, headline, topic label, or corner plaque above the cards.",
  "Forbidden placeholder text anywhere: 「标题设计」, 「标题」, 「主题」, Title, Untitled, or any invented heading.",
  "Each card is a SINGLE soft matte 3D clay block with ONE icon — no stacked duplicates, no ghosted layers, no torn paper.",
  "Do not draw start/end circles, badges, brand logos, dense UI panels, or English words outside the card row.",
  "Every Chinese string in quotes must be painted COMPLETE and fully legible — never cut a character mid-glyph.",
  "The only lettering is the Chinese strings in quotes on the three cards and the bottom summary.",
  "No neon cyberpunk, no dark space background, no graph-paper, no cute doodle stickers.",
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
      return `Clay card ${i + 1}: Chinese 「${p.label}」${extra}; emboss one simple soft-3D ${p.visual}.`;
    })
    .join(" ");

  return [
    SECTION_INFOGRAPHIC_STYLE,
    SECTION_COLOR_ROLES,
    `Arrangement: ${layout}. Prefer exactly ${panels.length} soft clay cards in one row, evenly spaced, fully inside the frame.`,
    `This is illustration ${sectionIndex + 1} of ${totalSections}.`,
    // 主题只作英文语境，避免中文 title 被模型画成左上角「标题设计」
    "Internal theme for icon mood only (never paint as text): tech workflow diagram.",
    boxLines,
    `Under the cards, a thin soft bracket line with Chinese 「${story.summary}」 centered below it.`,
    SECTION_RENDER_GUARDS,
  ].join(" ");
}
