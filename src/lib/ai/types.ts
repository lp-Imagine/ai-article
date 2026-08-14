/**
 * AI 文本任务角色。决定走主模型还是辅助模型。
 *
 * 主模型：outline / content / polish / expand / reformat / refine
 * 辅助模型：summary / titles / topic-ideas / cover-prompt / section-image
 */
export type TextRole =
  | "outline"
  | "content"
  | "summary"
  | "titles"
  | "topic-ideas"
  | "cover-prompt"
  | "polish"
  | "expand"
  | "section-image"
  | "reformat"
  | "refine";

export const PRIMARY_TEXT_ROLES: ReadonlySet<TextRole> = new Set<TextRole>([
  "outline",
  "content",
  "polish",
  "expand",
  "reformat",
  "refine",
]);

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
