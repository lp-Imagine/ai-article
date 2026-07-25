export const BLOG_SECTIONS = ["web", "ui", "tech", "computer", "misc"] as const;
export type BlogSection = (typeof BLOG_SECTIONS)[number];

export type BlogGroupOption = { id: string; label: string };

/** 与 vuepressblog 侧栏分组对齐 */
export const SECTION_GROUPS: Record<BlogSection, BlogGroupOption[]> = {
  web: [
    { id: "javascript", label: "JavaScript" },
    { id: "vue", label: "Vue" },
    { id: "react", label: "React" },
    { id: "ui-lib", label: "UI 组件" },
    { id: "misc", label: "其它" },
  ],
  ui: [
    { id: "html", label: "HTML" },
    { id: "css", label: "CSS" },
    { id: "misc", label: "其它" },
  ],
  tech: [
    { id: "docs", label: "常用文档" },
    { id: "github", label: "GitHub" },
    { id: "nodejs", label: "Node.js" },
    { id: "bookmarks", label: "资源收藏" },
    { id: "misc", label: "其它" },
  ],
  computer: [
    { id: "browser", label: "浏览器" },
    { id: "misc", label: "其它" },
  ],
  misc: [{ id: "misc", label: "其它" }],
};

const TAG_TO_GROUP: Array<{ re: RegExp; group: string }> = [
  { re: /vue/i, group: "vue" },
  { re: /react/i, group: "react" },
  { re: /element|antd|ui\s*组件|组件库/i, group: "ui-lib" },
  { re: /javascript|typescript|\bjs\b|\bts\b/i, group: "javascript" },
  { re: /\bcss\b|flex|布局|样式/i, group: "css" },
  { re: /\bhtml\b/i, group: "html" },
  { re: /git(?!hub)|npm|mysql|yaml|markdown|命令/i, group: "docs" },
  { re: /github/i, group: "github" },
  { re: /node/i, group: "nodejs" },
  { re: /浏览器|chrome|extension/i, group: "browser" },
];

export function inferBlogGroup(
  section: BlogSection,
  hints: string[],
): string {
  const groups = SECTION_GROUPS[section] ?? SECTION_GROUPS.misc;
  const allowed = new Set(groups.map((g) => g.id));
  const blob = hints.filter(Boolean).join(" ");
  for (const { re, group } of TAG_TO_GROUP) {
    if (re.test(blob) && allowed.has(group)) return group;
  }
  return groups[0]?.id ?? "misc";
}

export function isValidBlogGroup(section: BlogSection, group: string): boolean {
  return (SECTION_GROUPS[section] ?? []).some((g) => g.id === group);
}
